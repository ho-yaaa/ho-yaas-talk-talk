export function debounceAsync<TArgs extends unknown[], TResult>(
  fn: (signal: AbortSignal, ...args: TArgs) => Promise<TResult>,
  delayMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  return (...args: TArgs): Promise<TResult> => {
    if (timer) clearTimeout(timer);
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;

    return new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        fn(signal, ...args).then(resolve).catch(reject);
      }, delayMs);
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
        once: true,
      });
    });
  };
}
