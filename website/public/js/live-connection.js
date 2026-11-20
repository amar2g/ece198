// Keeps a page connected to the server's WebSocket and reconnects automatically
// (waits 1 s, 2 s, 4 s ... up to 10 s between tries).

export class LiveConnection {
  // handlers: onOpen(), onMessage(message), onStatus("connecting" | "connected" | "disconnected")
  constructor(url, { onOpen = () => {}, onMessage = () => {}, onStatus = () => {} }) {
    this.url = url;
    this.handlers = { onOpen, onMessage, onStatus };
    this.socket = null;
    this.retryDelay = 1000;
    this.stopped = false;
  }

  start() {
    this.handlers.onStatus("connecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.retryDelay = 1000;
      this.handlers.onStatus("connected");
      this.handlers.onOpen();
    });

    socket.addEventListener("message", (event) => {
      try {
        this.handlers.onMessage(JSON.parse(event.data));
      } catch (error) {
        console.error("Bad message from server:", error);
      }
    });

    socket.addEventListener("close", (event) => {
      this.handlers.onStatus("disconnected");
      // 4000 = joined from another tab, 4001 = removed by instructor: don't reconnect
      if (event.code === 4000 || event.code === 4001) {
        this.stopped = true;
        this.handlers.onMessage({ type: "closed-by-server", code: event.code });
      }
      if (this.stopped) return;
      setTimeout(() => this.start(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10_000);
    });
  }

  // Returns false if not connected right now
  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
}

// Server address -> WebSocket URL. Empty = the server this page came from.
// "192.168.1.5:3000" or "http://192.168.1.5:3000" -> "ws://192.168.1.5:3000/live"
export function liveUrlFor(serverAddress = "") {
  const host = serverAddress.trim().replace(/^\w+:\/\//, "").replace(/\/.*$/, "") || location.host;
  return `ws://${host}/live`;
}
