import 'fake-indexeddb/auto';

type MessageHandler = (event: MessageEvent<any>) => void;

class InlineWorker {
  private workerListeners = new Set<MessageHandler>();
  private mainListeners = new Set<MessageHandler>();
  private ready: Promise<void>;
  public onmessage: MessageHandler | null = null;

  constructor(url: string | URL) {
    this.ready = this.init(url);
  }

  private async init(url: string | URL) {
    const prevSelf = (globalThis as any).self;
    const workerSelf = {
      postMessage: (data: any) => this.dispatchToMain(data),
      addEventListener: (type: string, handler: MessageHandler) => {
        if (type === 'message') this.workerListeners.add(handler);
      },
      removeEventListener: (type: string, handler: MessageHandler) => {
        if (type === 'message') this.workerListeners.delete(handler);
      },
    };

    (globalThis as any).self = workerSelf;
    try {
      const workerUrl = typeof url === 'string' ? url : url.href;
      await import(workerUrl);
    } finally {
      (globalThis as any).self = prevSelf ?? globalThis;
    }
  }

  postMessage(data: any) {
    void this.ready.then(() => this.dispatchToWorker(data));
  }

  terminate() {
    this.workerListeners.clear();
    this.mainListeners.clear();
    this.onmessage = null;
  }

  addEventListener(type: string, handler: MessageHandler) {
    if (type === 'message') this.mainListeners.add(handler);
  }

  removeEventListener(type: string, handler: MessageHandler) {
    if (type === 'message') this.mainListeners.delete(handler);
  }

  private dispatchToWorker(data: any) {
    const event = { data } as MessageEvent<any>;
    this.workerListeners.forEach((handler) => handler(event));
  }

  private dispatchToMain(data: any) {
    const event = { data } as MessageEvent<any>;
    this.mainListeners.forEach((handler) => handler(event));
    if (this.onmessage) this.onmessage(event);
  }
}

if (typeof (globalThis as any).Worker === 'undefined') {
  (globalThis as any).Worker = InlineWorker as any;
}
