import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {digest, snapshot, glob, inside, readJSON} from './io.mjs';
import {taskDirectory, loadTask, mutateTask, saveTask, taskEvent, verifyCandidate} from './workbench.mjs';

const mime = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
export async function serveCandidate(task, {port = 0, host = '127.0.0.1', taskProvider, identity} = {}) {
  if (!['127.0.0.1','localhost','::1'].includes(host)) throw Error('Candidate preview binds to loopback; expose through an authenticated host proxy if needed');
  await verifyCandidate(task);
  const server = http.createServer(async (request, response) => {
    try {
      if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const current = taskProvider ? await taskProvider() : task, candidate = current.candidates.at(-1), directory = path.join(candidate.directory, 'site');
      if (request.url === '/__designer/status') { response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({id:current.id,candidate:candidate.hash,identity})); return; }
      let relative = decodeURIComponent(new URL(request.url, 'http://preview').pathname).replace(/^\//, '') || 'index.html';
      if (relative.split('/').some(s => s.startsWith('.')) || relative.includes('\\')) throw Error('Hidden or unsafe path');
      if (relative.endsWith('/')) relative += 'index.html';
      if (!candidate.artifacts[relative] && current.config.spa && !path.extname(relative)) relative = 'index.html';
      if (!candidate.artifacts[relative]) { response.writeHead(404).end(); return; }
      const bytes = await fs.readFile(inside(directory, relative));
      if (digest(bytes) !== candidate.artifacts[relative]) throw Error('Frozen file changed');
      response.writeHead(200, {'content-type': mime[path.extname(relative)] || 'application/octet-stream', 'cache-control':'no-store','x-designer-candidate':candidate.hash});
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(400).end('Invalid preview request'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return {server, url: 'http://' + host + ':' + server.address().port, close: () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); })};
}

export function fingerprintFor(task, candidate, check, environment) {
  const destinations=(check.expected||[]).filter(e=>e.type==='url').map(e=>new URL(e.value,'http://candidate').pathname);
  const destinationPages=task.config.pages.filter(p=>destinations.includes(p.route));
  const dependencies=[...check.dependsOn,...destinationPages.flatMap(p=>p.dependsOn)];
  const isSpecific = file => dependencies.some(pattern => glob(pattern, file));
  const isGlobal = file => /\.(?:css|[cm]?js|json|lock)$/.test(file) || (task.config.globalDependencies || []).some(pattern => glob(pattern, file)) || !task.checks.some(c => c.dependsOn.some(pattern => glob(pattern, file)));
  const source = Object.fromEntries(Object.entries(candidate.source).filter(([file]) => isSpecific(file) || isGlobal(file)));
  // All non-HTML output is conservative shared input. Local HTML changes can
  // reuse other routes; any unknown asset/script/data change rechecks all routes.
  const artifacts = Object.fromEntries(Object.entries(candidate.artifacts).filter(([file]) => !file.endsWith('.html') || file === check.route.slice(1) || destinations.some(route=>file===route.slice(1)) || (task.config.spa && file === 'index.html')));
  return digest({check, source, artifacts, rules: task.rules.manifestHash, lessons: task.lessonsHash, environment, checker: 2, config: task.config});
}

async function reusable(result, fingerprint) {
  if (!result || result.status !== 'pass' || result.fingerprint !== fingerprint || !result.evidence?.length) return false;
  if (result.cacheSafe === false || !result.observedAt || Date.now()-Date.parse(result.observedAt) > 30*60*1000) return false;
  for (const evidence of result.evidence) {
    try { if (digest(await fs.readFile(evidence.path)) !== evidence.hash) return false; } catch { return false; }
  }
  return true;
}

export async function incrementalPlan(task, candidate, environment) {
  const execute = [], reuse = [];
  for (const check of task.checks) {
    const fingerprint = fingerprintFor(task, candidate, check, environment), previous = task.results[check.id];
    if (!(task.invalidated || []).includes(check.id) && await reusable(previous, fingerprint)) reuse.push({check, fingerprint, previous});
    else execute.push({check, fingerprint});
  }
  return {execute, reuse};
}

function inspectPage(document,{siteType='coupon'}={}) {
  const failures = [], view = document.defaultView;
  if (document.documentElement.scrollWidth > view.innerWidth + 1) failures.push({reason: 'horizontal-overflow', actual: document.documentElement.scrollWidth, viewport: view.innerWidth});
  for (const image of document.querySelectorAll('img')) {
    const box = image.getBoundingClientRect();
    if (box.width && box.height && (!image.complete || !image.naturalWidth)) failures.push({reason: 'unloaded-image', src: image.getAttribute('src')});
  }
  for (const element of siteType==='coupon'?document.querySelectorAll('[data-site-role="merchant-logo"]'):[]) {
    const box = element.getBoundingClientRect();
    if (box.width && box.height && (box.width < 70 || box.height < 70)) failures.push({reason: 'merchant-logo-below-minimum', width:box.width,height:box.height});
  }
  return {url: view.location.href, viewport: {width: view.innerWidth,height: view.innerHeight}, failures};
}

async function scenario(page, check) {
  for (const action of check.actions || []) {
    if (action.type === 'click') await page.locator(action.selector).click();
    else if (action.type === 'fill') await page.locator(action.selector).fill(action.value);
    else if (action.type === 'press') await page.locator(action.selector).press(action.key);
    else if (action.type === 'reload') await page.reload({waitUntil:'networkidle'});
    else throw Error('Unsupported interaction action: ' + action.type);
  }
  for (const expected of check.expected || []) {
    if (expected.type === 'url') {
      const actual = new URL(page.url()); if (actual.pathname + actual.search !== expected.value) throw Error('Unexpected navigation: ' + actual.pathname + actual.search);
    } else if (expected.type === 'text') {
      const actual = await page.locator(expected.selector).innerText(); if (actual !== expected.value) throw Error('Unexpected text at ' + expected.selector);
    } else if (expected.type === 'visible') {
      if (!await page.locator(expected.selector).isVisible()) throw Error('Expected visible control: ' + expected.selector);
    } else if (expected.type === 'clipboard') {
      const actual = await page.evaluate(() => navigator.clipboard.readText()); if (actual !== expected.value) throw Error('Clipboard differs from frozen expected value');
    } else throw Error('Unsupported interaction expectation');
  }
}

export async function audit({data, id, executable = process.env.SITE_BROWSER_EXECUTABLE, browserFactory}) {
  return mutateTask(data, id, async task => {
    const candidate = await verifyCandidate(task);
    const browser = browserFactory ? await browserFactory() : await chromium.launch({executablePath: executable, headless: true});
    let preview;
    try {
      const environment = {browser: browser.version(), os: process.platform, arch: process.arch, locale:'en-US', timezone:'UTC', deviceScaleFactor:1, environmentTag:task.config.environmentTag || 'default'};
      const plan = await incrementalPlan(task, candidate, environment), results = {...task.results};
      for (const item of plan.reuse) results[item.check.id] = {...item.previous, candidate: candidate.hash, reusedFrom: {candidate: item.previous.candidate, fingerprint: item.fingerprint}};
      preview = await serveCandidate(task);
      const groups = new Map();
      for (const item of plan.execute) {
        const key = JSON.stringify([item.check.route,item.check.width,item.check.state,item.check.actions || []]);
        if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item);
      }
      let visits = 0;
      for (const items of groups.values()) {
        const check = items[0].check, directory = path.join(taskDirectory(data, id), 'evidence', candidate.hash);
        await fs.mkdir(directory, {recursive: true});
        const browserContext = await browser.newContext({viewport:{width:check.width,height:900}, locale:'en-US', timezoneId:'UTC', permissions:['clipboard-read','clipboard-write']});
        const page = await browserContext.newPage(), errors = [], externalRequests = new Set();
        page.on('request',request => { const url=new URL(request.url()); if (['http:','https:'].includes(url.protocol) && url.origin !== preview.url) externalRequests.add(url.origin); });
        page.on('pageerror', error => errors.push(error.message));
        let measured, failure;
        try {
          const response = await page.goto(preview.url + check.route, {waitUntil:'networkidle',timeout:30000}); visits++;
          if (!response?.ok()) throw Error('Page HTTP status is not successful');
          await page.evaluate(() => document.fonts.ready);
          await scenario(page, check);
          measured = await page.evaluate(({source,siteType}) => new Function('options','return ('+source+')(document,options)')({siteType}), {source:inspectPage.toString(),siteType:task.config.siteType||'coupon'});
          const actualRoute=new URL(page.url()).pathname,pageConfig=task.config.pages.find(p=>p.route===actualRoute);
          if(task.config.siteType==='games'){
            const {inspectGames}=await import(path.join(task.rules.directory,'site-types/games/bin/inspect-games.mjs'));
            if(!pageConfig){measured.games={status:'outside-site-scope',url:page.url(),notRun:['Destination is outside configured local page contracts; verify the declared navigation expectation separately']};}
            else if(pageConfig.ownerSelectors){measured.games=await page.evaluate(({source,options})=>new Function('options','return ('+source+')(document,options)')(options),{source:inspectGames.toString(),options:{page:pageConfig.family,selectors:pageConfig.ownerSelectors,scopeSelector:pageConfig.scopeSelector||'body'}});measured.failures.push(...measured.games.findings.filter(f=>f.level!=='target'));if(measured.games.status==='not-run')failure='Games selector bindings are incomplete';}
            else failure='Games ownerSelectors must be bound from the actual page; missing measurement is not-run';
          }
          if (errors.length) measured.failures.push(...errors.map(message => ({reason:'page-error',message})));
          const configured = pageConfig?.layoutChecks;
          if (configured?.length) {
            const module = await import(path.join(task.rules.directory, 'knowledge/imported/skills/site-design-review/scripts/inspect-layout.mjs'));
            const detail = await page.evaluate(({source, checks}) => new Function('checks','return (' + source + ')(document, window.getComputedStyle, {checks})')(checks), {source:module.inspectLayout.toString(),checks:configured});
            measured.configured = detail;
            if (detail.budget.failures.length) measured.failures.push(...detail.budget.failures);
            if (detail.budget.status === 'not-run') failure = 'Configured layout checks have missing execution';
          }
        } catch (error) { failure = error.message; measured = {failures:[{reason:'execution-failed',message:failure}]}; }
        const file = path.join(directory, digest([check.route,check.width,check.state,check.actions || []]) + '-'+randomUUID()+'.png');
        try { await page.screenshot({path:file,fullPage:true}); } catch { failure ||= 'Screenshot unavailable'; }
        const evidence = [];
        try { evidence.push({path:file,hash:digest(await fs.readFile(file))}); } catch { /* Missing evidence keeps this check unexecuted. */ }
        for (const item of items) results[item.check.id] = {id:item.check.id,kind:item.check.kind,candidate:candidate.hash,fingerprint:item.fingerprint,environment,evidence,observedAt:new Date().toISOString(),cacheSafe:externalRequests.size===0,externalOrigins:[...externalRequests],
          status: failure || !evidence.length ? 'not-run' : item.check.kind === 'visual' ? 'needs-observation' : measured.failures.length ? 'fail' : 'pass', measurements:measured,
          ...(failure ? {reason:failure} : {})};
        await browserContext.close();
        // Durable checkpoints after each visit; an interruption does not lose a sweep.
        await saveTask(data, {...task, results, status:'reviewing'});
      }
      await verifyCandidate(task);
      const next = taskEvent({...task, results, invalidated:[], status:plan.execute.length ? 'reviewing' : task.status, lastAudit:{candidate:candidate.hash,executed:plan.execute.length,reused:plan.reuse.length,visits,environment}}, 'audit', {executed:plan.execute.length,reused:plan.reuse.length,visits});
      await saveTask(data, next); return next;
    } finally { if (preview) await preview.close(); await browser.close(); }
  });
}

export async function status(data, id, detail = 'summary') {
  const task = await loadTask(data, id), candidate = task.candidates.at(-1);
  const counts = {};
  for (const check of task.checks) { const result = task.results[check.id], value = result?.candidate === candidate?.hash ? result.status : 'not-run'; counts[value] = (counts[value] || 0) + 1; }
  return {id, status:task.status, candidate:candidate?.hash, source:task.source, rulesVersion:task.rules.version, counts,
    lastAudit:task.lastAudit, coverage:task.coverage, approval:task.approval,
    ...(detail === 'full' ? {checks:task.checks.map(check => ({...check,result:task.results[check.id]})), feedback:task.feedback} : {
      pending:task.checks.filter(check => task.results[check.id]?.candidate !== candidate?.hash || task.results[check.id]?.status !== 'pass').map(check => ({id:check.id,kind:check.kind,route:check.route,width:check.width,criteria:check.criteria,status:task.results[check.id]?.status || 'not-run',evidence:task.results[check.id]?.evidence,failures:task.results[check.id]?.measurements?.failures})),latestFeedback:task.feedback.at(-1)
    })};
}
