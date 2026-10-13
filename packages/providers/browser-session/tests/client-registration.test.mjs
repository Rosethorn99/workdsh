import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as BrowserSession from '../dist/index.js';

test('Client surface registration does not create an unconfigured Host browser provider',()=>{
 const ctx={provide(){throw Error('Client-only registration must not provide Host services');}};
 assert.doesNotThrow(()=>BrowserSession.apply(ctx,undefined));
 assert.throws(()=>BrowserSession.apply(ctx,{}),/Electron worker or browser executable is required/);
});
