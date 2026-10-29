import assert from 'node:assert/strict';
import {applyCaptureTemplate,parseCaptureTags} from '../src/capture-notes';
const meeting='## Meeting\n\n### Discussion\n\n';
assert.equal(applyCaptureTemplate('','',meeting),meeting);
assert.equal(applyCaptureTemplate(meeting,meeting,'- [ ] '),'- [ ] ');
assert.equal(applyCaptureTemplate(meeting+'Typed text',meeting,'- [ ] '),meeting+'Typed text\n\n- [ ] ');
assert.equal(applyCaptureTemplate('中文 📝','',meeting),'中文 📝\n\n'+meeting);
assert.deepEqual(parseCaptureTags(' 工作，#灵感, 工作 '),['工作','灵感']);
console.log('PASS: templates preserve typed text; Chinese tags normalize');
