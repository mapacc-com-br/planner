const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise application actions without starting the network/bootstrap routine.
function harness() {
  const fields = new Map();
  const node = () => ({ value: '', textContent: '', innerHTML: '', disabled: false, hidden: false,
    classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, reset() {}, showModal() {}, close() {} });
  const document = { querySelector(selector) { if (!fields.has(selector)) fields.set(selector, node()); return fields.get(selector); }, querySelectorAll() { return []; } };
  const context = vm.createContext({ document, localStorage: { getItem: key => key.endsWith('selectedMonth') ? '2020-01' : null, setItem() {} }, window: {setTimeout: () => 1, clearTimeout() {}}, console, crypto: require('node:crypto').webcrypto, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').replace(/^initializeApp\(\);$/m, ''), context);
  const run = source => vm.runInContext(source, context);
  run(`todayKey = () => '2026-09-20'; selectedMonth = '2026-09'; ownerFilter = 'Todos';
    bills = [{ id:'luz', name:'Luz', amount:100, dueDate:'2026-07-31', recurrence:'Mensal', category:'Moradia', owner:'Ambos', notes:'', paid:false }];
    var calls = []; apiRequest = async (url, options) => { calls.push({url, ...options}); return {}; };
    refreshState = async () => {}; render = () => {};`);
  return { run, fields, context };
}

test('abrir conta nova não herda recorrência e usa o dia atual', () => {
  const {run,fields} = harness(); run('openBillDialog()');
  assert.equal(fields.get('#billRecurrence').value, 'Unica');
  assert.equal(fields.get('#billDueDate').value, '2026-09-20');
  assert.equal(fields.get('#billEditScopeField').hidden, true);
});

test('ajustar conta recorrente salva somente a ocorrência selecionada', async () => {
  const {run,fields} = harness();
  run("openBillDialog(getBillsForMonth('2026-09')[0])");
  fields.get('#billAmount').value = '128.55';
  await run('saveBillFromForm({preventDefault(){}})');
  const calls = JSON.parse(run('JSON.stringify(calls)'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/bill-occurrences');
  assert.equal(calls[0].body.competence, '2026-09');
  assert.equal(calls[0].body.amount, 128.55);
  run('billOccurrences = calls.map(c => c.body)');
  assert.equal(run("getBillsForMonth('2026-08')[0].amount"),100);
  assert.equal(run("getBillsForMonth('2026-09')[0].amount"),128.55);
  assert.equal(run("getBillsForMonth('2026-10')[0].amount"),100);
});

test('edição mensal não permite enviar vencimento de outro mês', async () => {
  const {run,fields} = harness(); run("openBillDialog(getBillsForMonth('2026-09')[0])");
  fields.get('#billDueDate').value = '2026-10-01';
  await run('saveBillFromForm({preventDefault(){}})');
  assert.equal(run('calls.length'),0);
  assert.match(fields.get('#toast').textContent,/dentro do mês/);
});

test('editar próximos meses usa a divisão explícita de recorrência', async () => {
  const {run,fields} = harness();run("openBillDialog(getBillsForMonth('2026-09')[0])");
  fields.get('#billEditScope').value='future';run('updateBillEditScope()');
  fields.get('#billAmount').value='150';
  await run('saveBillFromForm({preventDefault(){}})');
  assert.equal(run('calls[0].url'),'/api/recurring-bills/split');
  assert.equal(run('calls[0].body.competence'),'2026-09');
});

test('resumo usa valor efetivamente pago sem abater a diferença de outras contas', () => {
  const {run} = harness();
  run(`bills = [
    {id:'a',amount:100,paid:true,paidAmount:120,dueDate:'2026-09-01',recurrence:'Unica',owner:'Ambos'},
    {id:'b',amount:100,paid:false,dueDate:'2026-09-02',recurrence:'Unica',owner:'Ambos'},
    {id:'c',amount:100,paid:true,paidAmount:0,dueDate:'2026-09-03',recurrence:'Unica',owner:'Ambos'}
  ]; revenues=[{amount:500,date:'2026-09-01',owner:'Andre'}];`);
  const totals = JSON.parse(run('JSON.stringify(monthlyTotals())'));
  assert.deepEqual(totals,{income:500,paid:120,pending:100,total:220,balance:280});
});

test('retorno ao formulário mensal restaura campos globais para não prometer alterações ignoradas', () => {
  const {run,fields} = harness();run("openBillDialog(getBillsForMonth('2026-09')[0])");
  fields.get('#billEditScope').value='future';run('updateBillEditScope()');
  fields.get('#billName').value='Outro nome'; fields.get('#billRecurrence').value='Anual';
  fields.get('#billEditScope').value='one';run('updateBillEditScope()');
  assert.equal(fields.get('#billName').value,'Luz');
  assert.equal(fields.get('#billRecurrence').value,'Mensal');
});

test('Já paguei evita envio duplo e identifica o mês no pagamento', async () => {
  const {run} = harness();
  run("todayKey = () => dateKey(new Date()); selectedMonth=monthKey(new Date()); bills[0].dueDate=todayKey(); var paymentId=getMonthBills()[0].id;");
  await run('Promise.all([markPaidToday(paymentId), markPaidToday(paymentId)])');
  assert.equal(run('calls.length'),1);
  assert.equal(run('calls[0].body.amount'),100);
  assert.equal(run('calls[0].body.method'),'Nao informado');
  assert.equal(run('calls[0].url'),run('`/api/bills/${encodeURIComponent(paymentId)}/payment`'));
});

test('falha de rede não marca pagamento localmente e permite nova tentativa', async () => {
  const {run} = harness();
  run("todayKey = () => dateKey(new Date()); selectedMonth=monthKey(new Date()); bills[0].dueDate=todayKey(); var paymentId=getMonthBills()[0].id; apiRequest=async()=>{throw new Error('Sem conexão')};");
  await assert.rejects(run('markPaidToday(paymentId)'),/Sem conexão/);
  assert.equal(run('pendingPayments.size'),0);
  assert.equal(run('getMonthBills()[0].paid'),false);
});
