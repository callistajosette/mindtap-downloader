const { chromium } = require('playwright-core');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const dns = require('dns').promises;

const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

const TEST_MODE_MAX_PAGES = 1;

(async () => {
  const { address } = await dns.lookup('host.docker.internal');
  const browser = await chromium.connectOverCDP(`http://${address}:9222`);
  const defaultContext = browser.contexts()[0];
  const page = defaultContext.pages().find(p => p.url().includes('cengage.com'));
  
  if (!page) {
    console.error('Error: Could not find an active Cengage tab.');
    process.exit(1);
  }

  await page.bringToFront();
  const masterPdf = await PDFDocument.create();
  
  let pageNumber = 1;
  const readerFrame = page.frameLocator('.ActivityFrame__iFrame');

  while (true) {
    if (TEST_MODE_MAX_PAGES > 0 && pageNumber > TEST_MODE_MAX_PAGES) {
        console.log(`\nTest mode limit reached (${TEST_MODE_MAX_PAGES} pages). Ending extraction.`);
        break;
    }

    console.log(`Processing page ${pageNumber}...`);
    await page.waitForTimeout(randomDelay(3000, 5000));

    const printButton = readerFrame.locator('#init_print');
    
    if (await printButton.count() > 0) {
        console.log('Opening print preview dock...');
        await printButton.click({ delay: randomDelay(40, 120) });
        await page.waitForTimeout(randomDelay(2000, 3500));
        
        const dockFrame = page.frameLocator('iframe[name="1_APPDOCK"]');
        
        try {
            await dockFrame.locator('body').waitFor({ state: 'visible', timeout: 8000 });
            await page.waitForTimeout(2000); 
            
            // 1. Harvest native CSS from the main textbook reader frame
            const nativeStyles = await readerFrame.locator('link[rel="stylesheet"], style').evaluateAll(elements => 
                elements.map(el => el.outerHTML).join('\n')
            );
            
            let frameHtml = await dockFrame.locator('html').evaluate(node => node.outerHTML);
            
            frameHtml = frameHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
            // 2. Inject the base URL AND the harvested native styles into the head
            frameHtml = frameHtml.replace('<head>', `<head><base href="https://ng.cengage.com/">\n${nativeStyles}`);
            
            frameHtml = frameHtml.replace(/<div class="preview_header">/g, '<div class="preview_header" style="display:none !important;">');
            frameHtml = frameHtml.replace(/<div id="in_app_purchase_confirm">/g, '<div id="in_app_purchase_confirm" style="display:none !important;">');
            
            // 3. Strip the copyright header and footer blocks
            frameHtml = frameHtml.replace(/class="copyright_header"/g, 'class="copyright_header" style="display:none !important;"');
            frameHtml = frameHtml.replace(/class="copyright_stmt"/g, 'class="copyright_stmt" style="display:none !important;"');

            console.log('Rendering native vector PDF in background tab...');
            const renderPage = await defaultContext.newPage();
            await renderPage.setContent(frameHtml, { waitUntil: 'networkidle' }); 
            
            // Force the print engine to use web styles to retain colors
            await renderPage.emulateMedia({ media: 'screen' });
            
            await renderPage.waitForTimeout(1500); 

            const client = await renderPage.context().newCDPSession(renderPage);
            const { data } = await client.send('Page.printToPDF', {
                printBackground: true,
                displayHeaderFooter: false,
                marginTop: 0.4,
                marginBottom: 0.4,
                marginLeft: 0.4,
                marginRight: 0.4
            });

            console.log('Merging page into master PDF...');
            const pagePdf = await PDFDocument.load(Buffer.from(data, 'base64'));
            const copiedPages = await masterPdf.copyPages(pagePdf, pagePdf.getPageIndices());
            copiedPages.forEach((p) => masterPdf.addPage(p));

            await renderPage.close();
            
        } catch (e) {
            console.log('Failed to extract HTML from the print dock on this page.', e.message);
        }
        
        const closeBtn = page.locator('.AppDockFrame__icon.icon-cross');
        if (await closeBtn.count() > 0) {
            await closeBtn.click({ delay: randomDelay(40, 100) });
        }
        await page.waitForTimeout(randomDelay(1000, 2000));
    }

    console.log('Waiting for next button...');
    const nextBtn = readerFrame.locator('#ebook_right');
    
    try {
        await nextBtn.waitFor({ state: 'visible', timeout: 10000 });
        console.log('Clicking next page...');
        await nextBtn.click({ delay: randomDelay(40, 150) });
    } catch (error) {
        console.log('Next button did not reappear. End of chapter reached!');
        break;
    }
    
    pageNumber++;
  }

  console.log('Saving final document...');
  fs.writeFileSync('Chapter_Export.pdf', await masterPdf.save());
  console.log('\nSuccess! Native vector PDF saved as Chapter_Export.pdf');
  
  // Fix 2: Use close() to cleanly drop the CDP connection
  await browser.close(); 
})();