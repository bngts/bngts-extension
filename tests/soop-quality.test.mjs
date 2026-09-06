import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../soop-quality.js', import.meta.url), 'utf8');
function fixture(labels) {
  const listeners = {}, clicks = []; let mutation;
  const buttons = labels.map(label => ({
    label, disabled: false, item: { hidden: false, style: {} },
    closest() { return this.item; }, getAttribute() { return null; },
    querySelector() { return { textContent: this.label }; },
    classList: { contains: () => false }, click() { clicks.push(this.label); },
  }));
  const parent = { postMessage() {} };
  const window = { top: parent, parent, addEventListener(name, fn) { listeners[name] = fn; } };
  const box = { querySelectorAll: () => buttons };
  const context = {window, URL, Symbol, location:{hostname:'play.sooplive.com',pathname:'/alpha/direct'},
    document:{referrer:'https://bngts.com/multiview/watch/s:alpha',querySelector:()=>box},
    MutationObserver:class {constructor(fn){mutation=fn} observe(){} disconnect(){}},
    setTimeout:fn=>{queueMicrotask(fn);return 1},clearTimeout(){}
  };
  vm.runInNewContext(source,context);
  return {buttons,clicks,select(quality,origin='https://bngts.com'){listeners.message({source:parent,origin,data:{type:'bngts:multiview-quality',quality}})},
    async changed(){mutation([{target:{closest:()=>box},addedNodes:[]}]);await Promise.resolve()}};
}
test('720p to 1440p switches existing 1080p-source player to 1080p',()=>{
  const f=fixture(['자동','1080p','720p','360p']);f.select('720p');f.select('1440p');assert.deepEqual(f.clicks,['720p','1080p']);
});
test('exact quality, automatic quality, and below-source preference remain selectable',()=>{
  const f=fixture(['자동','1440p','1080p','720p','360p']);f.select('1440p');f.select('720p');f.select('auto');assert.deepEqual(f.clicks,['1440p','720p','자동']);
});
test('hidden and disabled options are excluded',()=>{
  const f=fixture(['1440p','1080p','720p']);f.buttons[0].item.style.display='none';f.buttons[1].disabled=true;f.select('1440p');assert.deepEqual(f.clicks,['720p']);
});
test('delayed source qualities are reconsidered without repeated clicks',async()=>{
  const f=fixture(['1080p','720p']);f.buttons[0].item.hidden=true;f.select('1440p');f.buttons[0].item.hidden=false;await f.changed();await f.changed();assert.deepEqual(f.clicks,['720p','1080p']);
});
test('foreign messages do not change quality',()=>{
 const f=fixture(['1080p']);f.select('1440p','https://unrelated.example');assert.deepEqual(f.clicks,[]);
});
