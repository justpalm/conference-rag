import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

test('source filters reach database queries and retain bounded, distinct library citations', async () => {
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: 'peace', innerHTML: '', textContent: '', addEventListener() {},
            classList: { add() {}, remove() {} },
        });
        return elements.get(id);
    }
    const boxes = ['conference', 'scripture', 'pmg'].map(value => ({
        value, checked: true, addEventListener(event, fn) { this.change = fn; },
    }));
    const sandbox = {
        console, document: { getElementById: element, querySelectorAll: () => boxes },
        window: { addEventListener() {} }, setTimeout, clearTimeout,
    };
    vm.createContext(sandbox);
    const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    vm.runInContext(source.replace('\ninitializeApp();', '\n// Skip browser startup in unit test'), sandbox);
    // Browser escaping is unrelated to these query and grouping checks.
    vm.runInContext('escapeHtml = text => String(text)', sandbox);
    assert.equal(vm.runInContext('selectedSources().length', sandbox), 3);
    boxes[0].checked = false;
    boxes[2].checked = false;
    let rpcCall;
    sandbox.fakeClient = { rpc: async (name, args) => {
        rpcCall = { name, args };
        return { data: [], error: null };
    } };
    vm.runInContext('supabaseClient = fakeClient', sandbox);
    await vm.runInContext('searchSentences([0.1])', sandbox);
    assert.equal(rpcCall.name, 'match_library_sentences');
    assert.deepEqual([...rpcCall.args.source_types], ['scripture']);
    sandbox.rows = [
        { id: 'c1', talk_id: 'c', source_type: 'conference', text: 'one', similarity: .9 },
        { id: 'c2', talk_id: 'c', source_type: 'conference', text: 'two', similarity: .8 },
        { id: 's1', talk_id: 's', source_type: 'scripture', title: 'Alma 32:1–3', text: 'verse one', similarity: .95 },
        { id: 's2', talk_id: 's', source_type: 'scripture', title: 'Alma 32:4–6', text: 'verse two', similarity: .94 },
    ];
    const grouped = vm.runInContext('groupByTalk(rows)', sandbox);
    assert.equal(grouped.length, 3);
    assert.equal(grouped.filter(x => x.source_type === 'scripture').length, 2);
    assert.equal(grouped.find(x => x.source_type === 'conference').text, 'one two');
    sandbox.libraryOnly = grouped.filter(x => x.source_type === 'scripture');
    sandbox.fakeClient.from = () => { throw Error('Unexpected full scripture chapter fetch'); };
    assert.equal((await vm.runInContext('fetchFullTalkText(libraryOnly)', sandbox)).length, 2);
    const calls = [];
    const query = {
        select() { return this; },
        in(field, values) { calls.push(['in', field, [...values]]); return this; },
        ilike() { return this; },
        limit() { calls.push(['limit']); return Promise.resolve({ data: [], error: null }); },
    };
    sandbox.fakeClient.from = () => query;
    await vm.runInContext('keywordSearch()', sandbox);
    assert.equal(calls[0][0], 'in');
    assert.deepEqual(calls[0][2], ['scripture']);
    assert.equal(calls[1][0], 'limit');
    boxes[1].checked = false;
    let invoked = false;
    sandbox.fakeClient.functions = { invoke() { invoked = true; throw Error('Unexpected API call'); } };
    await vm.runInContext('semanticSearch()', sandbox);
    assert.equal(invoked, false);
    assert.match(element('semantic-results').innerHTML, /Choose at least one/);
    boxes[1].checked = true;
    element('keyword-results').innerHTML = 'old';
    boxes[1].change();
    assert.equal(element('keyword-results').innerHTML, '');
});
