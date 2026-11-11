/**
 * The opening of the installed app (2026-11-08, owner: "Piltri, Find your
 * Piltri" - "super classy and brandy", where a phone showed the bare "P"
 * for a moment): on the cream of the app's launch screen, Piltri's letters
 * rise into focus one by one, a fine amber rule draws out beneath them,
 * "Find your Piltri" settles in, and the whole dissolves into the page -
 * about two seconds; a tap skips it.
 *
 * Plain markup and CSS (app/globals.css, "Launch splash"), switched on by
 * SPLASH_SCRIPT before the page has even loaded - so there's no flash of
 * the page first. Once per launch of the installed app (home screen);
 * `?splash=1` shows it in a browser, to look at.
 *
 * On the web too since 2026-11-11 (owner: "a little animation, kind of
 * similar to the app's"), a lighter one (data-splash-kind="web": no icon
 * disc - there's no app icon to come from - and about a second and a
 * half): when someone arrives from elsewhere - a typed address, a link, a
 * search - not while moving around Piltri or in a tab opened from it (the
 * referrer is Piltri), not on a reload (once per tab), not on the way back
 * from a sign-in email, and at most once every half hour. `?splash=web`
 * shows it, to look at.
 *
 * The way out (2026-11-11, owner: "a bit longer, and a lot smoother with
 * the transition to the Home page"): no dissolve any more - the wordmark
 * lands on the page's own. The script measures the page's logo
 * (.wordmark-split: the nav bar's "Piltri"), hides it, and glides the
 * splash's wordmark onto it - shrinking as it goes, for about a second -
 * while the cream clears and the rule and tagline let go; then the real
 * logo takes over where it stands (data-splash "land", then "landed").
 * With no logo to land on, reduced motion, or a tap before the letters
 * are all in (1.3 s), the old dissolve ("out").
 * The web one holds a little longer too (2.1 s, was 1.5).
 */
export const SPLASH_SCRIPT = `(function(){try{
var d=document.documentElement;
var q=location.search;
var asked=q.indexOf("splash=1")>=0?"app":q.indexOf("splash=web")>=0?"web":"";
var app=(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true;
var web=asked?asked==="web":!app;
if(!asked){
if(sessionStorage.getItem("piltri:splash"))return;
sessionStorage.setItem("piltri:splash","1");
if(web){
if(document.referrer&&document.referrer.indexOf(location.origin)===0)return;
if(location.hash.indexOf("access_token")>=0)return;
var last=+localStorage.getItem("piltri:splash-at")||0;
if(Date.now()-last<18e5)return;
localStorage.setItem("piltri:splash-at",String(Date.now()));
}
}
d.setAttribute("data-splash","in");
if(web)d.setAttribute("data-splash-kind","web");
var still=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
var done=false;
var t0=Date.now();
var clear=function(){d.removeAttribute("data-splash");d.removeAttribute("data-splash-kind")};
var fade=function(){d.setAttribute("data-splash","out");setTimeout(clear,560)};
var end=function(){if(done)return;done=true;
try{
if(Date.now()-t0<1300){fade();return}
var m=document.querySelector(".piltri-splash-mark");
var t=document.querySelector("header .wordmark-split")||document.querySelector("main .wordmark-split");
var a=m&&m.getBoundingClientRect(),b=t&&t.getBoundingClientRect();
if(still||!a||!b||!a.width||!b.width||b.bottom<0||b.top>innerHeight){fade();return}
var s=b.width/a.width;
var x=b.left+b.width/2-(a.left+a.width/2),y=b.top+b.height/2-(a.top+a.height/2);
t.style.visibility="hidden";
d.setAttribute("data-splash","land");
void m.offsetWidth;
m.style.transform="translate("+x+"px,"+y+"px) scale("+s+")";
setTimeout(function(){t.style.visibility="";d.setAttribute("data-splash","landed");setTimeout(function(){clear();m.style.transform=""},260)},1000);
}catch(e){fade()}
};
setTimeout(end,still?(web?700:900):(web?2100:1900));
d.addEventListener("pointerdown",end,{once:true,capture:true});
}catch(e){}})();`;

const LETTERS = ["P", "i", "l", "t", "r", "i"];

/** The phone's own launch screen comes first, before any page can load:
 *  on Android the app icon - the cream "P" on an amber disc - on the app's
 *  cream (2026-11-08, owner: "we can still see the old one"). So the
 *  splash opens on that same disc and P, and the P becomes the wordmark's
 *  first letter: the disc melts away as the P glides into its place and
 *  turns ink, and "iltri" rises beside it - one movement from the icon. */
export function LaunchSplash() {
  return (
    <div id="piltri-splash" aria-hidden="true">
      <p className="piltri-splash-mark">
        <span className="piltri-splash-disc" />
        {LETTERS.map((ch, i) => (
          <span
            key={i}
            style={{ "--i": i } as React.CSSProperties}
            className={i === 0 ? "piltri-splash-p" : i >= 3 ? "piltri-splash-letter piltri-splash-amber" : "piltri-splash-letter"}
          >
            {ch}
          </span>
        ))}
      </p>
      <span className="piltri-splash-rule" />
      <p className="piltri-splash-tag">Find your Piltri</p>
    </div>
  );
}
