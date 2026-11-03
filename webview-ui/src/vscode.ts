// webview-ui/src/vscode.ts
declare var acquireVsCodeApi: any;

const vscodeApi = acquireVsCodeApi();

export function sendMessage(command: string, data?: any) {
    const message: any = { command };
    
    if (typeof data === 'string') {
        message.text = data;
    } else if (data !== undefined) {
        message.data = data;
    }
    
    vscodeApi.postMessage(message);
}


// Listen for messages from the extension
export function onMessage(callback: (message: any) => void) {
    window.addEventListener('message', event => {
        const message = event.data;
        callback(message);
    });
}

// Export the vscode API instance with a different name
export { vscodeApi as vscode };