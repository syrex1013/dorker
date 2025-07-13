import { parentPort, workerData } from 'worker_threads';
import { SQLInjectionTester } from './sqlInjectionTester.js';

(async () => {
    const { urls, config, workerId } = workerData;
    if (!parentPort) {
        console.error('Worker started without parentPort');
        process.exit(1);
    }
    try {
        const tester = new SQLInjectionTester({ ...config, outputFile: config.outputFile || 'vuln.txt' });
        await tester.initialize();

        const results = [];
        for (const url of urls) {
            try {
                const [singleResult] = await tester.testUrls([url]);
                // Emit progress back to parent
                parentPort.postMessage({ type: 'progress', result: { ...singleResult, workerId } });
                results.push(singleResult);
            } catch (err) {
                parentPort.postMessage({ type: 'progress', result: { url, vulnerable: false, error: err.message, workerId } });
                results.push({ url, vulnerable: false, error: err.message });
            }
        }

        parentPort.postMessage({ type: 'complete', results });
    } catch (error) {
        parentPort.postMessage({ type: 'error', message: error.message });
    }
})(); 