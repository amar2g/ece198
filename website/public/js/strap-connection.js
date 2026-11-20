// Talks to the strap over USB using Web Serial (Chrome/Edge only, and only on
// trusted pages: localhost or https - see README "Multi-laptop demo").
// PretendStrap has the same methods and prints the same DATA lines, for testing without hardware.

const BAUD_RATE = 115200; // must match Serial.begin() in curl_strap.ino

export const isWebSerialAvailable = () => "serial" in navigator;

export class UsbStrap {
  // onLine(text) for each line received; onDisconnect(reason) if the strap goes away
  constructor({ onLine, onDisconnect }) {
    this.onLine = onLine;
    this.onDisconnect = onDisconnect;
    this.port = null;
    this.reader = null;
    this.closingOnPurpose = false;
  }

  // Shows Chrome's port picker; throws if the user cancels
  async connect() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: BAUD_RATE });
    this.readLoop();
  }

  async send(text) {
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(text));
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() {
    this.closingOnPurpose = true;
    await this.reader?.cancel().catch(() => {});
  }

  // Reads bytes, splits them into lines, passes each line to onLine
  async readLoop() {
    const decoder = new TextDecoder();
    let partial = "";
    let problem = "";

    // port.readable becomes null when the cable is pulled out
    while (this.port.readable && !this.closingOnPurpose) {
      this.reader = this.port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          partial += decoder.decode(value, { stream: true });
          const lines = partial.split("\n");
          partial = lines.pop(); // last piece may be incomplete
          lines.forEach((line) => this.onLine(line.replace(/\r$/, "")));
          if (partial.length > 1000) partial = ""; // garbage, e.g. wrong baud rate
        }
      } catch (error) {
        problem = error.message;
      } finally {
        this.reader.releaseLock();
      }
    }

    await this.port.close().catch(() => {});
    if (!this.closingOnPurpose) this.onDisconnect(problem || "Strap disconnected");
  }
}

// Fake strap: understands s, e, r and n<number> like the real one
export class PretendStrap {
  constructor({ onLine }) {
    this.onLine = onLine;
    this.repsPerSet = 8;
    this.mode = "IDLE"; // IDLE, ZEROING or SET
    this.repsDone = 0;
    this.goodDone = 0;
    this.nextRepIsReference = false;
    this.timer = null;
  }

  async connect() {
    this.onLine("DATA,READY");
  }

  async disconnect() {
    clearTimeout(this.timer);
  }

  async send(text) {
    const numberCommand = text.match(/^n(\d+)/);
    if (numberCommand) {
      this.repsPerSet = Number(numberCommand[1]);
      return;
    }
    const command = text.trim();
    if (command === "s" && this.mode === "IDLE") {
      this.mode = "ZEROING";
      this.repsDone = this.goodDone = 0;
      this.onLine("DATA,ZEROING");
      this.later(1500, () => {
        this.mode = "SET";
        this.onLine(`DATA,SET_START,${this.repsPerSet}`);
        this.nextRep();
      });
    } else if (command === "e") {
      if (this.mode === "ZEROING") this.onLine("DATA,SET_CANCELLED");
      if (this.mode === "SET") this.onLine(`DATA,SET_END,${this.repsDone},${this.goodDone}`);
      this.mode = "IDLE";
      clearTimeout(this.timer);
    } else if (command === "r" && this.mode === "SET") {
      this.nextRepIsReference = true; // like the real strap: the NEXT rep becomes the reference
    }
  }

  // A rep every 2.5-4.5 s, about 2 in 3 good
  nextRep() {
    this.later(2500 + Math.random() * 2000, () => {
      if (this.mode !== "SET") return; // set was ended meanwhile
      if (this.nextRepIsReference) {
        this.nextRepIsReference = false;
        this.onLine("DATA,REF,128.0,0.80,1.30,0.12");
        return this.nextRep();
      }
      this.repsDone++;
      const good = Math.random() < 0.65;
      if (good) this.goodDone++;
      this.onLine(good
        ? `DATA,REP,${this.repsDone},GOOD,128.4,0.71,1.22,0.14,NONE`
        : `DATA,REP,${this.repsDone},BAD,127.9,0.69,0.31,0.18,LOWER_FAST`);
      if (this.repsDone < this.repsPerSet) return this.nextRep();
      this.mode = "IDLE";
      this.onLine(`DATA,SET_END,${this.repsDone},${this.goodDone}`);
    });
  }

  later(ms, action) {
    this.timer = setTimeout(action, ms);
  }
}
