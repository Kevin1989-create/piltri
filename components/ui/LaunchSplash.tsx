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
 * the page first. Only when Piltri is opened as an installed app (home
 * screen), once per launch; `?splash=1` shows it in a browser, to look at.
 */
export const SPLASH_SCRIPT = `(function(){try{
var d=document.documentElement;
var asked=location.search.indexOf("splash=1")>=0;
var app=(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true;
if(!asked&&(!app||sessionStorage.getItem("piltri:splash")))return;
sessionStorage.setItem("piltri:splash","1");
d.setAttribute("data-splash","in");
var still=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
var done=false;
var end=function(){if(done)return;done=true;d.setAttribute("data-splash","out");setTimeout(function(){d.removeAttribute("data-splash")},560)};
setTimeout(end,still?900:1900);
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
