// Compact synonym groups: every word in a group is a synonym of the others.
const G = `
big,large,huge,vast,enormous,massive,sizeable,substantial,immense
small,little,tiny,compact,minor,slight,petite,modest
good,fine,excellent,great,superb,decent,splendid,wonderful
bad,poor,awful,terrible,dreadful,inferior,unpleasant
happy,glad,cheerful,joyful,pleased,delighted,content
sad,unhappy,sorrowful,miserable,gloomy,downcast,dejected
fast,quick,rapid,swift,speedy,brisk,prompt
slow,sluggish,gradual,unhurried,leisurely,plodding
smart,clever,intelligent,bright,sharp,astute,wise
stupid,foolish,silly,dim,unwise,thoughtless
beautiful,lovely,attractive,pretty,stunning,gorgeous,elegant
ugly,unattractive,unsightly,plain,hideous
important,significant,crucial,vital,essential,key,major
easy,simple,straightforward,effortless,painless,uncomplicated
hard,difficult,tough,challenging,demanding,arduous
begin,start,commence,launch,initiate,open
end,finish,conclude,complete,close,terminate,stop
show,display,present,exhibit,reveal,demonstrate
help,assist,aid,support,back,serve
use,employ,utilise,apply,operate
make,create,build,produce,construct,form,craft
get,obtain,acquire,receive,gain,secure,fetch
give,provide,supply,offer,grant,donate
take,grab,seize,accept,capture,collect
say,state,declare,mention,remark,announce,express
tell,inform,notify,advise,instruct,report
ask,enquire,inquire,question,query,request
answer,reply,respond,retort,rejoin
think,believe,consider,reckon,suppose,suspect
know,understand,grasp,realise,recognise,comprehend
want,desire,wish,crave,need,fancy
like,enjoy,love,appreciate,admire,relish
hate,dislike,detest,loathe,despise,resent
look,glance,gaze,stare,peek,observe,watch
see,notice,spot,observe,detect,perceive
go,move,travel,proceed,head,advance
come,arrive,approach,reach,appear
run,sprint,dash,race,jog,hurry
walk,stroll,stride,wander,amble,trek
change,alter,modify,adjust,vary,transform,revise
improve,enhance,upgrade,refine,boost,better
increase,grow,rise,expand,climb,escalate
decrease,reduce,lower,shrink,decline,diminish,cut
keep,retain,hold,preserve,maintain,save
leave,depart,exit,quit,withdraw,abandon
find,discover,locate,uncover,identify,detect
try,attempt,endeavour,strive,seek
need,require,demand,call for,necessitate
buy,purchase,acquire,procure
sell,vend,market,trade,retail
send,dispatch,forward,post,transmit
write,compose,draft,pen,author,record
read,peruse,scan,study,browse
talk,speak,chat,converse,discuss
meet,encounter,gather,convene,assemble
choose,select,pick,opt,elect,decide
explain,clarify,describe,illustrate,interpret
check,verify,confirm,test,examine,inspect
fix,repair,mend,correct,resolve,restore
break,smash,shatter,crack,snap,fracture
join,connect,link,unite,attach,combine
separate,divide,split,part,detach,sever
old,ancient,aged,elderly,vintage,dated,antique
new,fresh,novel,recent,modern,original,latest
strong,powerful,sturdy,robust,solid,mighty,tough
weak,feeble,frail,fragile,flimsy,delicate
rich,wealthy,affluent,prosperous,well-off
poor,needy,impoverished,destitute,broke
hot,warm,scorching,boiling,heated,burning
cold,chilly,cool,freezing,icy,frosty
clean,spotless,tidy,pristine,immaculate
dirty,filthy,grubby,soiled,messy,unclean
true,accurate,correct,genuine,real,factual,valid
false,untrue,incorrect,wrong,fake,mistaken
clear,obvious,evident,plain,apparent,transparent
unclear,vague,ambiguous,hazy,murky,confusing
many,numerous,several,countless,plenty,various
few,scarce,sparse,limited,rare
often,frequently,regularly,commonly,repeatedly
sometimes,occasionally,periodically,now and then
always,constantly,perpetually,invariably,forever
never,not once,at no time
very,extremely,highly,really,remarkably,exceptionally
also,too,additionally,furthermore,moreover,besides
but,however,yet,although,nevertheless,still
because,since,as,given that,due to
so,therefore,thus,hence,consequently
idea,concept,notion,thought,plan,proposal
problem,issue,difficulty,obstacle,trouble,snag
answer,solution,resolution,remedy,fix
result,outcome,consequence,effect,upshot
reason,cause,motive,grounds,rationale
way,method,approach,technique,means,manner
part,section,piece,portion,segment,component
group,team,band,set,collection,cluster
job,task,duty,role,position,occupation,work
boss,manager,supervisor,chief,leader,head
friend,companion,ally,mate,pal,colleague
enemy,foe,rival,opponent,adversary
people,folk,persons,individuals,public,citizens
house,home,residence,dwelling,property
road,street,route,path,way,lane
money,cash,funds,capital,finance,currency
mistake,error,blunder,slip,fault,oversight
chance,opportunity,opening,possibility,prospect
trouble,difficulty,bother,hassle,problem
start,beginning,outset,launch,onset
end,ending,conclusion,finale,close
big,great,grand,giant,gigantic,colossal
angry,furious,irate,annoyed,cross,livid,mad
afraid,scared,frightened,fearful,terrified,anxious
tired,weary,exhausted,fatigued,drained,sleepy
brave,courageous,bold,fearless,daring,heroic
kind,gentle,caring,generous,thoughtful,considerate
rude,impolite,discourteous,blunt,curt
quiet,silent,hushed,still,peaceful,soft
loud,noisy,deafening,booming,thunderous
interesting,fascinating,engaging,compelling,intriguing
boring,dull,tedious,monotonous,uninteresting
funny,amusing,humorous,comical,witty,hilarious
strange,odd,unusual,peculiar,weird,curious,bizarre
normal,ordinary,typical,usual,standard,regular,average
different,distinct,diverse,unlike,varied
same,identical,alike,equivalent,similar,matching
whole,entire,complete,full,total,intact
enough,sufficient,adequate,ample
perfect,flawless,ideal,faultless,impeccable
careful,cautious,wary,prudent,attentive,meticulous
careless,sloppy,reckless,negligent,hasty
famous,renowned,celebrated,well-known,notable,prominent
rare,uncommon,scarce,unusual,exceptional
common,widespread,frequent,familiar,everyday
possible,feasible,viable,achievable,likely
necessary,essential,required,needed,compulsory,vital
final,last,ultimate,closing,concluding
first,initial,opening,earliest,original,primary
main,chief,principal,primary,leading,central,key
whole,overall,general,broad,comprehensive
show,prove,establish,indicate,demonstrate
support,back,endorse,champion,uphold,sustain
reject,refuse,decline,deny,dismiss,spurn
allow,permit,let,enable,authorise,approve
stop,halt,cease,pause,discontinue,end
wait,pause,delay,linger,hold on,remain
happen,occur,take place,arise,transpire
seem,appear,look,sound,come across as
include,contain,comprise,involve,incorporate
suggest,propose,recommend,advise,advocate
agree,concur,consent,accept,assent
argue,debate,dispute,quarrel,contend
win,triumph,succeed,prevail,conquer
lose,mislay,misplace,forfeit,drop
teach,instruct,educate,train,coach,tutor
learn,study,master,absorb,pick up
build,construct,assemble,erect,develop
destroy,demolish,wreck,ruin,devastate,raze
hide,conceal,cover,mask,bury,veil
share,split,distribute,divide,allocate
rely,depend,count,lean,trust
protect,defend,guard,shield,safeguard,preserve
`;
const MAP = new Map();
for (const line of G.trim().split('\n')) {
  const words = line.split(',').map((w) => w.trim()).filter(Boolean);
  for (const w of words) {
    if (!MAP.has(w)) MAP.set(w, new Set());
    for (const o of words) if (o !== w) MAP.get(w).add(o);
  }
}
const stem = (w) => {
  const c = [w];
  if (w.endsWith('ies')) c.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ing')) { c.push(w.slice(0, -3), w.slice(0, -3) + 'e'); if (w.length > 5 && w[w.length - 4] === w[w.length - 5]) c.push(w.slice(0, -4)); }
  if (w.endsWith('ed')) { c.push(w.slice(0, -2), w.slice(0, -1)); if (w.length > 4 && w[w.length - 3] === w[w.length - 4]) c.push(w.slice(0, -3)); }
  if (w.endsWith('es')) c.push(w.slice(0, -2));
  if (w.endsWith('s')) c.push(w.slice(0, -1));
  if (w.endsWith('ly')) c.push(w.slice(0, -2));
  if (w.endsWith('er') || w.endsWith('est')) c.push(w.replace(/(er|est)$/, ''));
  return c;
};
// Returns {word, list} or null. The result is matched back to the case of the original word by the caller.
export function lookup(raw) {
  const w = raw.toLowerCase().trim();
  for (const s of stem(w)) {
    if (MAP.has(s)) return { word: s, list: [...MAP.get(s)].sort() };
  }
  return null;
}
export const size = MAP.size;
