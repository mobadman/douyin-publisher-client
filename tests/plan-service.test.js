const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PlanService } = require('../src/plan-service');

test('损坏的当前计划不会阻断账号等其他模块初始化', () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-plan-'));
  fs.writeFileSync(path.join(cacheRoot, 'current-plan.json'), '{"tags":[美的官方旗舰店]}', 'utf8');
  const service = new PlanService({ settings: () => ({}) }, { cacheRoot }, {});
  const plan = service.current();
  assert.equal(plan.invalid, true);
  assert.equal(plan.status, 'invalid');
  assert.deepEqual(plan.items, []);
  assert.match(plan.statusDetail, /格式损坏/);
});
