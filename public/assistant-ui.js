// Chat is kept in memory here; persisted history belongs to the authenticated server account.
export function createAssistant({ api, onSaved, navigate }) {
  const $ = id => document.getElementById(id);
  let state={messages:[],proposals:[],revision:0,enabled:false}, epoch=0, busy=false;
  const make = (tag,cls,text) => {const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;};
  function status(text) { $('aiStatus').textContent=text; }
  function controls() {
    $('aiSend').disabled=busy || !state.enabled || !$('aiConsent').checked;
    $('aiNewChat').disabled=busy;
    $('aiMessage').disabled=busy;
    $('aiConsent').disabled=busy;
    $('aiHistory').disabled=busy;
    $('aiMessages').setAttribute('aria-busy',String(busy));
  }
  function render() {
    const wrap=$('aiMessages'); wrap.replaceChildren();
    if(!state.messages.length){
      wrap.append(make('p','ai-welcome','Let’s build a routine that fits your life. Tell me what you want to work towards, or ask how to use GymSpear.'));
    }
    for(const message of state.messages){
      const item=make('article','ai-message '+message.role);
      item.append(make('p','ai-speaker',message.role==='user'?'You':'GymSpear AI'),make('p','ai-copy',message.content));
      if(message.proposalId){
        const plan=state.proposals.find(p=>p.id===message.proposalId);
        if(plan){
          const preview=make('section','ai-plan');preview.append(make('h2','',plan.title));
          for(const workout of plan.workouts){
            const detail=make('details','ai-workout'); detail.open=true;
            detail.append(make('summary','',new Date(workout.date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})+' · '+workout.day));
            if(workout.notes)detail.append(make('p','',workout.notes));
            const list=make('ul');for(const e of workout.entries){ const li=make('li');li.append(make('strong','',e.exercise),make('span','',e.note));list.append(li); }detail.append(list);preview.append(detail);
          }
          preview.append(make('p','ai-note','Adds new planned workouts. Existing plans and completed sessions stay as they are.'));
          const button=make('button','ai-save',plan.accepted?'Added to your plan':'Add to my plan');button.type='button';button.disabled=plan.accepted||busy;
          button.addEventListener('click',()=>void accept(plan));preview.append(button);item.append(preview);
        }
      }
      wrap.append(item);
    }
    controls();
  }
  async function load() {
    if(busy)return;
    const version=epoch;status('Loading your conversation…');
    try{const data=await api('/api/v2/assistant');if(version!==epoch)return;state=data;render();status(data.enabled?'20 messages per day. Online access required.':'The assistant is temporarily unavailable.');}
    catch(e){if(version===epoch)status(e.message);}
  }
  async function send(event) {
    event.preventDefault(); if(busy||!state.enabled||!$('aiConsent').checked)return;
    const message=$('aiMessage').value.trim();if(!message)return;
    const version=epoch;busy=true;render();status('Thinking through your request…');
    try{
      const data=await api('/api/v2/assistant/chat','POST',{message,revision:state.revision,requestId:crypto.randomUUID(),
        consent:true,includeHistory:$('aiHistory').checked,today:localDate()});
      if(version!==epoch)return;state=data;$('aiMessage').value='';render();status('Reply ready. Review any suggested plan before adding it.');
      $('aiMessages').lastElementChild?.scrollIntoView({block:'nearest',behavior:'instant'});
    }catch(e){if(version===epoch)status(e.message+' Use Reload chat to check whether a reply was saved.');}
    finally{if(version===epoch){busy=false;render();}}
  }
  async function accept(plan) {
    if(busy||plan.accepted)return;
    const version=epoch;busy=true;render();status('Adding reviewed workouts to your plan…');
    try{
      await api('/api/v2/assistant/accept','POST',{proposalId:plan.id});
      if(version!==epoch)return;plan.accepted=true;await onSaved();if(version!==epoch)return;
      status('Saved to your account. Open Plan to view or edit the workouts.');
    }catch(e){if(version===epoch)status(e.message+' Reload chat before trying again.');}
    finally{if(version===epoch){busy=false;render();}}
  }
  function reset(){epoch++;busy=false;state={messages:[],proposals:[],revision:0,enabled:false};$('aiMessage').value='';$('aiConsent').checked=false;$('aiHistory').checked=false;render();status('');}
  $('aiForm').addEventListener('submit',send);
  $('aiConsent').addEventListener('change',controls);
  $('aiReload').addEventListener('click',()=>void load());
  $('aiNewChat').addEventListener('click',async()=>{
    if(busy||!confirm('Clear this conversation and its suggestions? Workouts already saved to Plan will remain.'))return;
    const version=epoch;busy=true;controls();
    try{const data=await api('/api/v2/assistant/clear','POST',{});if(version!==epoch)return;state=data;status('Conversation cleared.');}
    catch(e){if(version===epoch)status(e.message);}
    finally{if(version===epoch){busy=false;render();}}
  });
  document.querySelectorAll('[data-ai-prompt]').forEach(button=>button.addEventListener('click',()=>{$('aiMessage').value=button.dataset.aiPrompt;$('aiMessage').focus();}));
  document.querySelectorAll('[data-ai-view]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.aiView)));
  return {load,reset};
}
function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
