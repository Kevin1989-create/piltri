// Root ("/") now serves the Explore landing page directly (2026-09-26, on
// request: "remove the current Home page... and replace it by the current
// Piltri explore page. Hence when we search for Piltri.me we arrive on
// this directly") - a plain re-export, not a duplicate copy, so this and
// /explore never drift apart. The original 3-card marketing home page
// moved to /home, fully intact and unlinked, rather than deleted - see
// that file's own comment for why it's kept around.
export { default } from "./explore/page";
