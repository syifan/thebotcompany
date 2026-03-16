import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeWrite, executeEdit, executeRead, executeTool } from '../src/agent-runner.js';

describe('Tool input validation (#72)', () => {
  describe('executeWrite', () => {
    it('should not crash when file_path is undefined', () => {
      const result = executeWrite({ content: 'hello' }, '/tmp');
      assert.ok(typeof result === 'string');
      assert.match(result, /error/i);
    });

    it('should not crash when file_path is null', () => {
      const result = executeWrite({ file_path: null, content: 'hello' }, '/tmp');
      assert.ok(typeof result === 'string');
      assert.match(result, /error/i);
    });

    it('should not crash when file_path is a number', () => {
      const result = executeWrite({ file_path: 42, content: 'hello' }, '/tmp');
      assert.ok(typeof result === 'string');
      assert.match(result, /error/i);
    });
  });

  describe('executeEdit', () => {
    it('should not crash when file_path is undefined', () => {
      const result = executeEdit({ old_string: 'a', new_string: 'b' }, '/tmp');
      assert.ok(typeof result === 'string');
      assert.match(result, /error/i);
    });

    it('should not crash when file_path is null', () => {
      const result = executeEdit({ file_path: null, old_string: 'a', new_string: 'b' }, '/tmp');
      assert.ok(typeof result === 'string');
      assert.match(result, /error/i);
    });
  });

  describe('executeRead', () => {
    it('should not crash when file_path is undefined', () => {
      const result = executeRead({}, '/tmp');
      assert.ok(typeof result === 'string');
      assert.match(result, /error/i);
    });
  });

  describe('executeTool', () => {
    it('should not crash when Write tool receives no file_path', async () => {
      const result = await executeTool('Write', { content: 'hello' }, '/tmp');
      assert.ok(typeof result === 'string');
      assert.match(result, /error/i);
    });

    it('should not crash when Edit tool receives no file_path', async () => {
      const result = await executeTool('Edit', { old_string: 'a', new_string: 'b' }, '/tmp');
      assert.ok(typeof result === 'string');
      assert.match(result, /error/i);
    });

    it('should not crash when Read tool receives no file_path', async () => {
      const result = await executeTool('Read', {}, '/tmp');
      assert.ok(typeof result === 'string');
      assert.match(result, /error/i);
    });
  });
});
