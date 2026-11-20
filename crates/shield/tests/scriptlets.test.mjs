// Runs the generated YouTube document-start script in Node with a minimal
// browser stub, then checks that ad data is stripped from player responses.
// Usage: node crates/shield/tests/scriptlets.test.mjs <path-to-dumped-script>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const script = readFileSync(process.argv[2], 'utf8');

globalThis.window = globalThis;
globalThis.location = { hostname: 'www.youtube.com' };
globalThis.document = {
  documentElement: { appendChild() {} },
  head: null,
  createElement: () => ({}),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
};
class FakeXHR {
  open() {}
  get response() { return this._r; }
  get responseText() { return this._r; }
}
globalThis.XMLHttpRequest = FakeXHR;
const realFetch = async (url) => new Response(JSON.stringify({
  videoDetails: { videoId: 'abc' },
  playerAds: [{ ad: 1 }],
  adPlacements: [{ ad: 2 }],
}), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = realFetch;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;

// Run the injected script exactly as the browser would.
new Function(script)();
globalThis.setInterval = realSetInterval;

// 1. set-constant: ytInitialPlayerResponse assigned later by the page.
window.ytInitialPlayerResponse = { playerAds: ['ad'], adPlacements: ['ad'], videoDetails: { title: 't' } };
assert.equal(window.ytInitialPlayerResponse.playerAds, undefined, 'playerAds not stripped');
assert.equal(window.ytInitialPlayerResponse.adPlacements, undefined, 'adPlacements not stripped');
assert.equal(window.ytInitialPlayerResponse.videoDetails.title, 't', 'video data damaged');

// 2. json-prune: JSON.parse of a player response.
const parsed = JSON.parse('{"playerResponse":{"adPlacements":[1],"streamingData":{"x":1}}}');
assert.equal(parsed.playerResponse.adPlacements, undefined, 'json-prune failed');
assert.deepEqual(parsed.playerResponse.streamingData, { x: 1 });
assert.deepEqual(JSON.parse('{"a":1}'), { a: 1 }, 'unrelated JSON changed');

// 3. json-prune-fetch-response: SPA navigation fetches /youtubei/v1/player.
const resp = await fetch('https://www.youtube.com/youtubei/v1/player?key=k');
const body = await resp.json();
assert.equal(body.playerAds, undefined, 'fetch playerAds not stripped');
assert.equal(body.adPlacements, undefined, 'fetch adPlacements not stripped');
assert.equal(body.videoDetails.videoId, 'abc');
const other = await (await fetch('https://www.youtube.com/youtubei/v1/browse')).json();
assert.equal(other.videoDetails.videoId, 'abc');

console.log('scriptlet tests passed');
