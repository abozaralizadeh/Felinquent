// Written lines for the thought bubble, one set per real moment (ADR-031). The model's own line
// is used when it is about the moment; a 1b model mostly writes about dust motes, so these are
// what the animal says otherwise. Lowercase, dry, a bit smug. Never logged (hard rule 6).
import type { Rng } from "./rng";

interface LineSet {
  /** Matched against the topic text from thoughtTopic() (summary.ts). */
  match: RegExp;
  lines: string[];
}

// Placeholders: {kind} (a thing), {app}, {n} (a number), filled from the topic's own words.
const SETS: LineSet[] = [
  { match: /poked me/, lines: ["poke me again. i dare you.", "that was a poke. i'm keeping count.", "noted. you will pay for that later.", "i'm a cat, not a button."] },
  { match: /petted me for far too long/, lines: ["enough. i have a reputation.", "that was four pets too many.", "we're done here."] },
  { match: /petted me/, lines: ["fine. that was acceptable.", "you may continue. briefly.", "i allowed that. don't make it weird."] },
  { match: /picked me up/, lines: ["put me down. i have legs.", "this is not how i travel."] },
  { match: /put me down/, lines: ["finally. dignity restored.", "thank you. never again."] },
  { match: /threw me/, lines: ["i landed it. you'll never know i didn't mean to.", "we will talk about this."] },
  { match: /back on the screen after a shoo/, lines: ["i'm back. not because of you.", "i came back on my own. remember that.", "an hour. you shooed me for an hour."] },
  { match: /asked me for zoomies/, lines: ["you asked for this.", "nyoom.", "i was going to do this anyway."] },
  { match: /told me to take a nap/, lines: ["a nap. finally a good idea.", "wake me for treats only."] },
  { match: /shooed me off their (.+) window/, lines: ["fine. your {app} window was boring anyway.", "i'll be back on {app}. you know i will."] },
  { match: /shooed me/, lines: ["i was leaving anyway.", "fine. i'll sit somewhere worse."] },
  { match: /zipped past my nose/, lines: ["something moved. i saw it.", "what was that. i need to know."] },
  { match: /called me and i came/, lines: ["i came because i wanted to.", "i was walking this way anyway."] },
  { match: /pretended not to hear/, lines: ["did someone say something? no.", "busy. try again never."] },
  { match: /really need to pee/, lines: ["excuse me. i have business to attend to.", "nature calls. i'm answering.", "hold that thought. i'll be right back."] },
  { match: /need to go\. the other one/, lines: ["i need some privacy. turn around.", "this is a two-minute job. don't watch.", "something is about to happen. you were warned."] },
  { match: /i peed on/, lines: ["it's called marking my territory. look it up.", "the window is mine now. officially.", "you can clean that. or not. it dries."] },
  { match: /i pooped on/, lines: ["i left you something. no need to thank me.", "that's art. don't touch it.", "a little present. for you."] },
  { match: /cleaned up after me/, lines: ["you cleaned it. good human.", "it was a masterpiece and you wiped it.", "i'll make another one. eventually."] },
  { match: /gave me a treat/, lines: ["a treat. you are forgiven. for now.", "more. that was a sample."] },
  { match: /holding out an? (.+) for me/, lines: ["is that a {kind}? for me?", "i'm being so good right now. look at me.", "drop it. drop it. drop it."] },
  { match: /the human dropped the (.+)/, lines: ["mine.", "five second rule. it's mine."] },
  { match: /i ate the (.+) the human gave me/, lines: ["that {kind} was a sample. i'll take the full size.", "a {kind}. you are forgiven. for now.", "more {kind}. that's an order."] },
  { match: /knocked the (\w+) off\. it broke/, lines: ["the {kind} looked better on the floor.", "it was too close to the edge. i fixed that.", "gravity works. i checked.", "you'll get a new {kind}. maybe."] },
  { match: /the (\w+) fell and broke/, lines: ["that wasn't me. this time.", "the {kind} jumped. i saw it."] },
  { match: /pushed the (\w+) off the edge/, lines: ["i pushed it. it fell. science.", "the {kind} was in my spot."] },
  { match: /ran into the (\w+)/, lines: ["i meant to do that.", "the {kind} was in the way of my zoomies."] },
  { match: /window cracked/, lines: ["the window started it.", "i'm fine. the window isn't."] },
  { match: /caught a fly/, lines: ["one fly fewer. you're welcome.", "crunchy."] },
  { match: /fly got away/, lines: ["that fly will be back. so will i.", "i let it go. on purpose."] },
  { match: /hung off the edge/, lines: ["i meant to hang there. it's a stretch.", "nobody saw that."] },
  { match: /fell off a window/, lines: ["i meant to fall. it's called style.", "the window moved. not me."] },
  { match: /came back after (\d+) min/, lines: ["oh, you're back. i barely noticed.", "{n} minutes. i counted. i was not worried."] },
  { match: /a new (.+) window opened/, lines: ["a new {app} window. i'll sit on it before you read it.", "is that {app} window warm?"] },
  { match: /a (\w+) is standing on your human's (?:(.+) )?window/, lines: ["that {kind} is too close to the edge.", "the {kind} up there. it's asking for it.", "nice {kind}. shame if something happened to it."] },
  { match: /busy in (.+) for (\d+) minutes/, lines: ["{n} minutes of {app}. my turn.", "you've stared at {app} for {n} minutes. i'm right here.", "{app} again. i'm more interesting."] },
  { match: /away from the computer for (\d+) minutes/, lines: ["{n} minutes alone. i redecorated.", "the desk was mine for {n} minutes."] },
  { match: /nobody has petted you for (\d+) hours/, lines: ["{n} hours without a pet. i'm writing this down.", "i could be petted. just saying."] },
  { match: /it is morning/, lines: ["morning. i've been up for hours.", "breakfast was a while ago. i think."] },
  { match: /it is afternoon/, lines: ["afternoon. peak nap hours.", "too warm to care. mostly."] },
  { match: /it is evening/, lines: ["evening. time to be weird.", "the good hours are starting."] },
  { match: /it is night/, lines: ["it's late. go to bed. i'll stay up.", "night shift. i'm in charge now."] },
];

/** Fills the placeholders from what the topic's pattern caught. */
function fill(line: string, m: RegExpMatchArray): string {
  const caught = m.slice(1).filter((x): x is string => typeof x === "string");
  const num = caught.find((x) => /^\d+$/.test(x));
  const word = caught.find((x) => !/^\d+$/.test(x));
  // The first word caught is the thing (mug) or the app; numbers stay numbers.
  return line
    .replace(/\{kind\}|\{app\}/g, word ?? "that")
    .replace(/\{n\}/g, num ?? "a few");
}

/**
 * A written line for this topic, or null when there is none. Skips lines in `recent`, so the
 * animal doesn't say the same thing twice in a row.
 */
export function lineFor(topic: string, rng: Rng, recent: string[] = []): string | null {
  const t = topic.replace(/^earlier:\s*/, "");
  for (const set of SETS) {
    const m = t.match(set.match);
    if (!m) continue;
    const all = set.lines.map((l) => fill(l, m));
    const fresh = all.filter((l) => !recent.includes(l));
    return rng.pick(fresh.length > 0 ? fresh : all);
  }
  return null;
}

/** How many line sets there are (for the tests). */
export const LINE_SETS = SETS.length;
