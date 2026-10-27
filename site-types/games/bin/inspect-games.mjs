// Read-only, browser-serializable measurements. Bind selectors from the real
// candidate; this never edits the page or certifies artwork/runtime/feedback.
export function inspectGames(document,{page,selectors={},scopeSelector='body',mobile}={}){
  const view=document.defaultView,findings=[],measurements=[],notRun=[],bindings=[];
  const phone=mobile??view.innerWidth<=767;
  const visible=e=>{const r=e.getBoundingClientRect(),s=view.getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0;};
  const get=(name,required=true)=>{
    const selector=selectors[name];
    if(typeof selector!=='string'||!selector.trim()){if(required)notRun.push({check:name,reason:'Agent must bind the actual selector'});return [];}
    let nodes;try{nodes=[...document.querySelectorAll(selector)].filter(visible);}catch{notRun.push({check:name,reason:'Invalid selector'});return [];}
    bindings.push({name,selector,matches:nodes.length});
    if(required&&!nodes.length)findings.push({check:name,reason:'missing-visible-required-module'});
    return nodes;
  };
  const measure=(check,value,expected)=>{measurements.push({check,value,expected});if(value<expected[0]-.75||value>expected[1]+.75)findings.push({check,reason:'outside-required-range',value,expected});};
  const root=document.querySelector(scopeSelector);if(!root)return {status:'not-run',notRun:[{check:'scope',reason:'Missing actual scope root'}],findings:[],measurements:[]};
  if(page==='home'){
    for(const canvas of get('homeCanvas')){const r=canvas.getBoundingClientRect();measure('home-left-gutter',r.left,[20,40]);measure('home-right-gutter',document.documentElement.clientWidth-r.right,[20,40]);}
    for(const category of get('categories',false))findings.push({check:'home-no-category-module',reason:'visible-homepage-category-module',text:category.textContent.trim().slice(0,80)});
    for(const icon of get('gameIcons',false)){const r=icon.getBoundingClientRect();if(Math.abs(r.width/r.height-1)>.08)findings.push({check:'home-square-artwork',level:'target',reason:'non-square-icon-frame',width:r.width,height:r.height});}
    notRun.push({check:'home-visual-and-disclosure',reason:'View background continuity and real hover/focus/tap information; geometry cannot certify them'});
  }
  let content;
  if(['detail','play'].includes(page)){
    const containers=get('contentContainer');content=containers[0];
    for(const container of containers){const r=container.getBoundingClientRect(),parent=container.parentElement,parentStyle=parent&&view.getComputedStyle(parent),available=parent?(parent.clientWidth-(parseFloat(parentStyle.paddingLeft)||0)-(parseFloat(parentStyle.paddingRight)||0)):document.documentElement.clientWidth;if(!phone&&available>=1200)measure('inner-content-width-1200',r.width,[1200,1200]);else if(r.left<-.75||r.right>document.documentElement.clientWidth+.75)findings.push({check:'inner-content-containment',reason:'container-outside-viewport'});}
  }
  if(page==='detail'){
    const rail=get('topRecommendations'),identity=get('identity');
    if(rail[0]&&identity[0]&&rail[0].getBoundingClientRect().top>identity[0].getBoundingClientRect().top)findings.push({check:'detail-top-game-recommendation-row',reason:'recommendations-are-not-before-identity'});
    if(!phone)for(const how of get('howToPlay')){const style=view.getComputedStyle(how),children=[...how.children].filter(visible).map(e=>e.getBoundingClientRect());if(Number(style.columnCount)>1||children.some((a,i)=>children.some((b,j)=>i!==j&&Math.abs(a.left-b.left)>4&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>4)))findings.push({check:'detail-how-single-column',reason:'parallel-instruction-columns'});}
  }
  if(page==='play'){
    for(const info of get('bottomInformation'))if(content){const a=content.getBoundingClientRect(),b=info.getBoundingClientRect();measure('bottom-information-width',b.width,[a.width,a.width]);measure('bottom-information-left-offset',b.left-a.left,[0,0]);}
    if(!phone)for(const e of get('fullscreen',false))findings.push({check:'play-no-desktop-fullscreen',reason:'visible-desktop-fullscreen-control',text:e.textContent.trim()});
    for(const e of get('backToDetail',false))findings.push({check:'play-no-detail-back-button',reason:'visible-detail-back-control',text:e.textContent.trim()});
    notRun.push({check:'generated-loading-art-and-progress',reason:'Observe the actual loading state; verify Image provenance, motion, real progress/indeterminate state and failure/retry separately'});
  }
  if(phone)for(const e of [root,...root.querySelectorAll('*')].filter(visible)){
    const nativeText=e.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=image]),select,textarea,button');
    if(!nativeText&&![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
    const size=parseFloat(view.getComputedStyle(e).fontSize);if(size>24+.01)findings.push({check:'mobile-font-maximum-24',reason:'visible-font-exceeds-24',fontSize:size,text:(e.value||e.placeholder||e.textContent).trim().slice(0,80)});
  }
  for(const prose of get('prose',false)){
    if([...prose.querySelectorAll('br')].some(e=>view.getComputedStyle(e).display!=='none'&&e.getClientRects().length))findings.push({check:'full-container-natural-text-wrap',reason:'hard-line-break-needs-semantic-review',text:prose.textContent.trim().slice(0,80)});
    const p=prose.parentElement;if(p){const s=view.getComputedStyle(p),available=p.getBoundingClientRect().width-(parseFloat(s.paddingLeft)||0)-(parseFloat(s.paddingRight)||0),r=prose.getBoundingClientRect();if(r.width<available*.85)findings.push({check:'full-container-natural-text-wrap',reason:'narrow-prose-track-needs-layout-review',width:r.width,available});}
  }
  for(const subtitle of get('moduleDescriptions',false))findings.push({check:'module-heading-without-description',reason:'visible-module-intro-description',text:subtitle.textContent.trim().slice(0,80)});
  const clickableTargets=[...root.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[onclick],[tabindex]')].filter(visible).map(e=>({tag:e.tagName.toLowerCase(),label:(e.getAttribute('aria-label')||e.textContent||e.getAttribute('title')||'').trim().slice(0,100),bounds:{width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}}));
  if(phone)notRun.push({check:'mobile-all-targets-pressed-feedback',reason:'Operate every actual clickable target and capture pressed feedback, including redraw states; the inventory alone is not acceptance'});
  return {status:notRun.some(x=>/bind|selector|scope/i.test(x.reason))?'not-run':findings.some(f=>f.level!=='target')?'fail':'measured',page,phone,viewport:{width:view.innerWidth,height:view.innerHeight},bindings,findings,measurements,clickableTargets,notRun,limit:'Read-only measurements and review candidates only. No visual, Image provenance, interaction, gameplay or independent acceptance is certified.'};
}
