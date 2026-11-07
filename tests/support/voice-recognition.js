export async function installVoiceMock(page) {
  await page.evaluate(() => {
    window.voiceProbe = { sessions: [], error: null };
    window.SpeechRecognition = class {
      constructor() { window.voiceProbe.sessions.push(this); this.aborts = 0; this.stops = 0; }
      start() {
        this.lateResult = (results) => this.savedResult?.({ results });
        this.savedResult = this.onresult;
        if (window.voiceProbe.error) this.onerror?.({ error: window.voiceProbe.error });
        else this.onstart?.();
      }
      stop() { this.stops++; this.onend?.(); }
      abort() { this.aborts++; }
      emit(words) { this.onresult?.({ results: words.map((transcript) => [{ transcript }]) }); }
    };
  });
}
