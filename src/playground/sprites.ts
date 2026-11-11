import { OWN_ANIMS, SHAKE_SEC, TURN_SEC, type Anim } from "../core/executor";
import { SCRATCH_SEC } from "../core/scenes";
import { GAIT_STRIDE } from "./gaits";
import { GROUND } from "./ground";
import { HEADS } from "./heads";

/**
 * Illustrated sprites (see docs/art-and-ux.md §5). Each character has fourteen sheets of drawn
 * poses, flow in-betweens between drawings that follow each other (tools/tween-sprites.py), licks
 * made by nodding one drawing (tools/nod-sprites.py) and 76 gait frames rigged from the standing
 * drawing (tools/rig-gait.py): a 32 frame walk, a 24 frame trot and a 20 frame run. This file plays
 * them. It picks the frames for each animation, glides between neighbouring frames (so motion is
 * smooth at any frame rate), cross-fades between poses that are not neighbours, plays turning round,
 * washing and the ear scratch as little programs, and adds breathing in code.
 *
 * draw.ts draws the characters without sprites (and also draws while images load, and in tests,
 * where there is no Image).
 */
const BASE = ["sit", "walk_a", "walk_b", "sleep", "groom", "jump", "crouch", "loaf", "wave"] as const;
const WALK = ["walk1", "walk2", "walk3", "walk4", "walk5", "walk6", "walk7", "walk8", "stand"] as const;
const RUN = ["run1", "run2", "run3", "run4", "run5", "run6", "prep", "fall", "land"] as const;
const FACE = ["blink", "yawn", "joy", "sulk", "surprise", "sneeze", "lookup", "meow", "curious"] as const;
const ACTION = ["stretch", "knead_a", "knead_b", "swat_a", "swat_b", "scratch", "chase", "retch", "proud"] as const;
const LIFE = ["sleep_b", "sleep_c", "wake", "dangle", "peek", "box", "gift", "back", "rub"] as const;
const GROOM = ["groom1", "groom2", "groom3", "groom4", "groom5", "groom6", "groom7", "groom8", "groom9"] as const;
const SPIN = ["spin1", "spin2", "spin3", "spin4", "spin5", "spin6", "spin7", "spin8", "spin9"] as const;
const REACT = ["angry", "hiss", "puffed", "annoyed", "flustered", "play_bow", "leap", "belly", "bark"] as const;
const PLAY = ["shy", "beg", "dig", "sniff", "tumble", "sprawl", "howl", "giggle", "startled"] as const;
const SEQ = ["stretch1", "stretch2", "stretch3", "shake", "presneeze", "sneeze2", "dazed", "retch1", "retch2"] as const;
const TRANS = ["stand2", "sitting_down", "sit2", "lowering", "loaf2", "drowsy", "curl", "deep", "waking"] as const;
const EXTRA = ["tiptoe", "perch", "wiggle_a", "wiggle_b", "love", "tail_a", "tail_b", "hop"] as const;
const SCRATCH = ["scratch1", "scratch2", "scratch3", "scratch4", "scratch5", "scratch6", "scratch7", "scratch8", "scratch9"] as const;
/** Sitting, a front paw reaches out, taps, comes back (paw1 to paw5, paw9), and a swat: wind-up, strike, follow-through (paw6 to paw8). Nothing is ever held. */
const PAW = ["paw1", "paw2", "paw3", "paw4", "paw5", "paw6", "paw7", "paw8", "paw9"] as const;
/** Turning round: standing (s) and sitting (t), head round, three quarters, front, then the far side mirrored. */
const TURN = ["turn_s1", "turn_s2", "turn_s3", "turn_s4", "turn_s5", "turn_t1", "turn_t2", "turn_t3", "turn_t4", "turn_t5", "slow_blink"] as const;
/** Following something with the head, sitting (sg_) and standing (tg_): down, ahead, up a little, up high, straight up, at you, and an ear twitch or a freeze. Only the head moves. */
const LOOK = ["sg_down", "sg_ahead", "sg_up", "sg_high", "sg_top", "sg_you", "sg_ear"] as const;
const LOOKSTAND = ["tg_down", "tg_ahead", "tg_up", "tg_high", "tg_top", "tg_you", "tg_freeze"] as const;
/** On a ledge: the tail swung forward and back, looking down, dozing, a lazy kick, looking at you. Peeking: along the ledge, ducking, up high. */
const LEDGE = ["perch_fwd", "perch_back", "perch_down", "perch_doze", "perch_kick", "perch_you", "peek_back", "peek_duck", "peek_up"] as const;
/** The loaf (a blink, looking up, looking back, drowsy) and lying on the side (a big stretch, the tail flicked up, rolling, belly up wriggling). */
const RESTING = ["loaf_blink", "loaf_up", "loaf_back", "loaf_drowse", "sprawl_stretch", "roll1", "roll2", "belly_l", "belly_r"] as const;
/** Play: into the play bow, the bow, springing up; a twisting leap (a rabbit's binky); hopping for joy and a happy wiggle. */
const JOYFUL = ["bow_down", "bow_l", "bow_up", "binky", "hop_crouch", "hop_up", "hop_land", "wiggle"] as const;
/** Sniffing along the ground and up, digging with one paw and the other and a look, the stalking crouch, the wiggle and the launch. */
const NOSE = ["sniff1", "sniff2", "sniff3", "dig1", "dig2", "dig3", "stalk1", "stalk2", "stalk3"] as const;
/** Sitting: a howl rising, held and falling, a bark, giggling both ways, chattering at something high, a big call. */
const VOICE = ["howl1", "howl2", "howl3", "bark1", "bark2", "giggle1", "giggle2", "chatter1", "meow2"] as const;
/** Standing: cross, the tail lashing both ways, a hiss coming and full, puffed up and side-stepping, a jump back. */
const MOOD = ["cross", "angry1", "angry2", "hiss1", "hiss2", "puff1", "puff2", "jumpback"] as const;
/** Sitting: annoyed (and a tail thump), flustered, peeking through a paw, sitting pretty (paws up and down), a headbutt and a cheek rub, smug. */
const FEEL = ["annoyed1", "annoyed2", "fluster1", "shy1", "beg1", "beg2", "headbutt1", "headbutt2", "proud2"] as const;
/**
 * The head in the other directions (7 Nov 2026), sitting (sq_, sb_) and standing (tq_, tb_): turned
 * three quarters toward you looking down, level and up; back over the shoulder down, level, up and
 * high; and a head tilt, ahead and at you. With the look sheets that is every way a head goes.
 */
const GAZE = ["sq_down", "sq_level", "sq_up", "sb_down", "sb_level", "sb_up", "sb_high", "sg_tilt", "sg_tiltyou"] as const;
const GAZESTAND = ["tq_down", "tq_level", "tq_up", "tb_down", "tb_level", "tb_up", "tb_high", "tg_tilt", "tg_tiltyou"] as const;
/** Licking with the tongue drawn moving: a paw at the mouth, the tip out, flat on the paw, curled back, going in; the chest; the lips. */
const LICK = ["lick1", "lick2", "lick3", "lick4", "lick5", "chest1", "chest2", "lips1", "lips2"] as const;
/**
 * It has to go (ADR-048): the squat to pee (a dog lifts a leg), relieved; the hunched squat to poop,
 * straining; standing, a look back at the spot; covering it (a cat rakes with a front paw, a dog
 * kicks back); a hind paw shaken; and a sheepish look at you in the middle of a poop.
 */
const POTTY = ["pee1", "pee2", "poop1", "poop2", "pottyback", "cover1", "cover2", "pawshake", "sheepish"] as const;
/**
 * Each animal's own moves (ADR-067, the <id>-sig sheets). Only that animal has these drawings, and
 * only its set loads them (OWN_KEYS). The dog: a shake head to tail (three twists and the fluffed
 * end), chewing its toy lying down (mouth shut, chewing with eyes shut, a look up), the tail wagging.
 * The chihuahua shakes too (no front view), and has a paw up standing and sitting, a shiver, and
 * under its blanket: ears and nose, peeking out, asleep.
 */
const OWN_DOG = ["dshake1", "dshake2", "dshake3", "dshake4", "chew1", "chew2", "chew3", "wag1", "wag2", "wag3"] as const;
const OWN_CHIHUAHUA = ["pawup", "pawup_sit", "shiver", "blanket1", "blanket2", "blanket3"] as const;
/** The fox mousing: head down listening, tilted; the leap up, at the top, diving; in the ground; out; pushing earth with the nose. */
const OWN_FOX = ["listen1", "listen2", "mouse_up", "mouse_top", "mouse_dive", "mouse_in", "mouse_out", "nosepush1", "nosepush2"] as const;
/** The raccoon: hands in the water three ways, looking at its hands, two ways of going through a box, a toss over the shoulder, a find at its chest and nibbled. */
const OWN_RACCOON = ["wash1", "wash2", "wash3", "inspect", "rummage1", "rummage2", "toss", "hold1", "hold2"] as const;
/** The rabbit: the binky's other twist, up on alert and the stamp, the flop over and lying flat, nibbling, an ear pulled down and licked. */
const OWN_RABBIT = ["binky2", "thump1", "thump2", "flop1", "flop2", "nibble1", "nibble2", "earwash1", "earwash2"] as const;
/** The squirrel: a nut at the mouth and nibbled, held at the chest, the cheeks stuffed, patting earth down, a flick of the tail, on the side of a window head up and head down. */
const OWN_SQUIRREL = ["nut1", "nut2", "nut3", "cheeks", "pat1", "pat2", "flick", "cling_up", "cling_down"] as const;

type Drawn =
  | (typeof BASE)[number] | (typeof WALK)[number] | (typeof RUN)[number] | (typeof FACE)[number] | (typeof ACTION)[number] | (typeof LIFE)[number]
  | (typeof EXTRA)[number] | (typeof GROOM)[number] | (typeof SPIN)[number] | (typeof SEQ)[number] | (typeof TRANS)[number] | (typeof REACT)[number]
  | (typeof PLAY)[number] | (typeof SCRATCH)[number] | (typeof TURN)[number] | (typeof PAW)[number] | (typeof LOOK)[number] | (typeof LOOKSTAND)[number]
  | (typeof LEDGE)[number] | (typeof RESTING)[number] | (typeof JOYFUL)[number] | (typeof NOSE)[number] | (typeof VOICE)[number] | (typeof MOOD)[number] | (typeof FEEL)[number]
  | (typeof GAZE)[number] | (typeof GAZESTAND)[number] | (typeof LICK)[number] | (typeof POTTY)[number]
  | (typeof OWN_DOG)[number] | (typeof OWN_CHIHUAHUA)[number] | (typeof OWN_FOX)[number] | (typeof OWN_RACCOON)[number] | (typeof OWN_RABBIT)[number] | (typeof OWN_SQUIRREL)[number];
/**
 * Frames made from the drawings: `groom1t1` and `groom1t2` sit between groom1 and the frame after it,
 * another letter is a second link out of the same drawing (`groom5u1` leads back to groom2), and
 * `groom2n1` to `groom2n5` are groom2 nodding down and back up (a lick).
 */
type Made = `${Drawn}${"t" | "u" | "v" | "w" | "x" | "d" | "l" | "f" | "m" | "n" | "p" | "g" | "h" | "k" | "c" | "q" | "b" | "y" | "j" | "o" | "z"}${1 | 2 | 3 | 4 | 5}`;

/**
 * Gait cycles rigged from the standing drawing (tools/rig-gait.py): a walk in lateral sequence, a trot
 * and a run. Every frame is the same drawing with the legs moved, so nothing flickers.
 */
type GaitKey = `g${"w" | "t" | "r"}${number}`;
const gait = (p: "gw" | "gt" | "gr", n: number): GaitKey[] => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(2, "0")}` as GaitKey);
const GW = gait("gw", 32);
const GT = gait("gt", 24);
const GR = gait("gr", 20);
const GAITISH = /^(g[wtr]\d|stand$|stand2$)/;
/** The head-direction drawings and their in-betweens (a swap between two directions cross-fades fast). */
const GAZE_KEY = /^(s[gqb]_|t[gqb]_)/;

export type SpriteKey = Drawn | Made | GaitKey;

/** A run of frames backwards. */
const rev = (keys: readonly SpriteKey[]): SpriteKey[] => [...keys].reverse();
/**
 * Each frame made from the drawings: the drawing it starts from, the one it goes to, and how far along
 * it is (0 to 1). Its size and its mouth come from those two (see sizeFix and mouthOf).
 */
const BETWEEN = new Map<string, readonly [SpriteKey, SpriteKey, number]>();
/** A chain of drawings with `n` in-betweens after each one but the last, named the way tween-sprites.py names them. */
function chain(names: readonly SpriteKey[], n = 2, tag = "t"): SpriteKey[] {
  names.forEach((k, i) => {
    const to = names[i + 1];
    if (to !== undefined) for (let j = 0; j < n; j++) BETWEEN.set(`${k}${tag}${j + 1}`, [k, to, (j + 1) / (n + 1)]);
  });
  return names.flatMap((k, i) => (i === names.length - 1 ? [k] : [k, ...Array.from({ length: n }, (_, j) => `${k}${tag}${j + 1}` as SpriteKey)]));
}
/** A loop: in-betweens after every drawing, the last ones leading back to the first. */
function dense(names: readonly SpriteKey[], n: number): SpriteKey[] {
  names.forEach((k, i) => {
    const to = names[(i + 1) % names.length] as SpriteKey;
    for (let j = 0; j < n; j++) BETWEEN.set(`${k}t${j + 1}`, [k, to, (j + 1) / (n + 1)]);
  });
  return names.flatMap((k) => [k, ...Array.from({ length: n }, (_, i) => `${k}t${i + 1}` as SpriteKey)]);
}
/** Two drawings and the in-betweens from one to the other. */
const link = (a: SpriteKey, b: SpriteKey, tag = "t"): SpriteKey[] => chain([a, b], 2, tag);
/** One lick: a drawing nodded down and back up (nod-sprites.py), ending where it started. */
const nodOf = (k: SpriteKey): SpriteKey[] => {
  for (let i = 1; i <= 5; i++) BETWEEN.set(`${k}n${i}`, [k, k, 0]);
  return [k, ...[1, 2, 3, 4, 5].map((i) => `${k}n${i}` as SpriteKey), k];
};

const GROOM_LOOP = dense(GROOM, 2);
const TURN_STAND = chain(["stand", "turn_s1", "turn_s2", "turn_s3", "turn_s4", "turn_s5"]);
const TURN_SIT = chain(["sit", "turn_t1", "turn_t2", "turn_t3", "turn_t4", "turn_t5"]);
/**
 * A turn plays its drawings one after another like a drawn turnaround, without blending (two views
 * of a body blended show two heads). The in-betweens into and out of the front view are left out:
 * flow cannot follow a body turning that far, and they come out with doubled eyes.
 */
const STEPS_OF = (c: readonly SpriteKey[]): SpriteKey[] => c.filter((k) => !/^turn_[st][23]t\d$/.test(k));
const TURN_STEPS = { stand: STEPS_OF(TURN_STAND), sit: STEPS_OF(TURN_SIT) };
const TURN_SETS = [new Set(TURN_STAND), new Set(TURN_SIT)];
/** Two frames of one turn swap straight away, like the drawings of a turnaround. */
const sameTurn = (a: SpriteKey, b: SpriteKey): boolean => TURN_SETS.some((set) => set.has(a) && set.has(b));
const KNEAD = [...dense(["knead_a", "knead_b"], 3), "knead_a"] as SpriteKey[];
const RETCH = [...dense(["retch1", "retch2"], 2), "retch1"] as SpriteKey[];
const MEOW = link("sit", "meow", "m");
/** The tongue: into the cycle from the paw at the mouth, one stroke (tip, flat on the paw, curled, in), and back. The chest and the lips the same way. */
const LICK_IN = link("groom2", "lick1", "y");
const LICK_LOOP = [...dense(["lick1", "lick2", "lick3", "lick4", "lick5"], 2), "lick1"] as SpriteKey[];
const LICK_OUT = link("lick1", "groom2", "y");
const CHEST_IN = link("groom7", "chest1", "y");
const CHEST_LOOP = [...dense(["chest1", "chest2"], 2), "chest1"] as SpriteKey[];
const CHEST_OUT = link("chest1", "groom7", "y");
const LIPS_IN = link("sit", "lips1", "y");
const LIPS_LOOP = [...dense(["lips1", "lips2"], 2), "lips1"] as SpriteKey[];
const LIPS_OUT = link("lips1", "sit", "y");
/** The potty moves have three in-betweens a link (not two): slow, big body moves that must not jump. */
const link3 = (a: SpriteKey, b: SpriteKey, tag = "t"): SpriteKey[] => chain([a, b], 3, tag);
const PEE_IN = link3("stand", "pee1", "j");
const PEE_LOOP = [...dense(["pee1", "pee2"], 3), "pee1"] as SpriteKey[];
const POOP_IN = link3("stand", "poop1", "o");
const POOP_LOOP = [...dense(["poop1", "poop2"], 3), "poop1"] as SpriteKey[];
const SHEEPISH_IN = link3("poop1", "sheepish", "u");
const SHEEPISH_OUT = link3("sheepish", "poop1", "u");
/**
 * Getting up out of the squat is the way down played backwards. The look back at the spot is a quick
 * swap of the head (like the gaze): flow can't follow a head swinging round that far and the
 * in-betweens came out with doubled eyes.
 */
const PEE_UP = rev(PEE_IN);
// The first in-between down (stando1) is a blur that only works going fast: getting up skips it.
const POOP_UP: SpriteKey[] = ["poop1", "stando3", "stando2", "stand"];
const COVER_IN = link3("stand", "cover1", "c");
const COVER_LOOP = [...dense(["cover1", "cover2"], 3), "cover1"] as SpriteKey[];
const COVER_OUT = link3("cover1", "stand", "c");
const SHAKE_IN = link3("stand", "pawshake", "z");
const SHAKE_OUT = link3("pawshake", "stand", "z");

/** Every frame made from the drawings (tools/tween-all.sh makes them). */
const MADE: SpriteKey[] = [
  ...GROOM_LOOP, ...link("groom5", "groom2", "u"), ...link("groom2", "groom6", "u"), ...(["groom2", "groom6", "groom7", "groom8", "sniff2"] as const).flatMap(nodOf),
  ...TURN_STAND, ...TURN_SIT, ...chain(SCRATCH), ...KNEAD, ...RETCH, ...MEOW,
  ...chain(["sitting_down", "sit2", "sit"]), ...link("stand", "sitting_down", "d"), ...link("sit", "stand2", "v"), ...link("stand2", "stand"), ...link("sit2", "lowering", "l"),
  ...chain(["lowering", "loaf2", "drowsy", "curl", "sleep"]), ...link("loaf2", "loaf", "f"), ...chain(["waking", "wake", "sit"]),
  ...chain(["stretch1", "stretch2", "stretch3", "shake"]), ...chain(["presneeze", "sneeze2", "dazed"]),
  ...link("sit", "paw1", "p"), ...chain(["paw1", "paw2", "paw3", "paw4", "paw5", "paw9"]), ...link("paw9", "sit", "p"),
  ...link("paw1", "paw6", "u"), ...chain(["paw6", "paw7", "paw8"]), ...link("paw8", "paw5", "u"),
  // The motion sheets (see tools/tween-all.sh for what each link is).
  ...link("sit", "sg_ahead", "g"), ...chain(["sg_down", "sg_ahead", "sg_up", "sg_high", "sg_top"]), ...link("sg_ahead", "sg_you", "u"), ...link("sg_ahead", "sg_ear", "v"),
  ...link("stand", "tg_ahead", "g"), ...chain(["tg_down", "tg_ahead", "tg_up", "tg_high", "tg_top"]), ...link("tg_ahead", "tg_you", "u"), ...link("tg_ahead", "tg_freeze", "v"),
  ...dense(["perch_fwd", "perch_back"], 3), ...link("perch_fwd", "perch_down", "u"), ...link("perch_fwd", "perch_doze", "v"), ...link("perch_fwd", "perch_kick", "w"), ...link("perch_fwd", "perch_you", "x"),
  ...link("peek", "peek_back"), ...link("peek", "peek_duck", "u"), ...link("peek", "peek_up", "v"),
  ...link("loaf", "loaf_blink"), ...link("loaf", "loaf_up", "u"), ...link("loaf", "loaf_back", "v"), ...link("loaf", "loaf_drowse", "w"),
  ...link("sprawl", "sprawl_stretch"), ...link("sprawl", "roll1", "u"), ...link("belly", "belly_l"), ...dense(["belly_l", "belly_r"], 2),
  ...chain(["bow_down", "bow_l", "bow_up"]), ...dense(["hop_crouch", "hop_up", "hop_land"], 2), ...link("hop_crouch", "binky", "u"),
  ...dense(["sniff1", "sniff2", "sniff3"], 2), ...dense(["dig1", "dig2"], 2), ...link("dig2", "dig3", "u"), ...link("dig3", "dig1"), ...dense(["stalk1", "stalk2"], 2), ...link("stalk2", "stalk3", "u"),
  ...link("sit", "howl1", "h"), ...chain(["howl1", "howl2", "howl3", "sit"]), ...link("sit", "bark1", "k"), ...dense(["bark1", "bark2"], 2), ...dense(["giggle1", "giggle2"], 2),
  ...link("sg_high", "chatter1", "c"), ...link("sit", "meow2", "w"),
  ...link("stand", "cross", "x"), ...link("cross", "angry1"), ...dense(["angry1", "angry2"], 2), ...link("cross", "hiss1", "u"), ...dense(["hiss1", "hiss2"], 2), ...dense(["puff1", "puff2"], 2),
  ...dense(["annoyed1", "annoyed2"], 2), ...link("flustered", "fluster1"), ...link("shy", "shy1"), ...link("beg", "beg1"), ...dense(["beg1", "beg2"], 2), ...dense(["headbutt1", "headbutt2"], 2), ...link("proud", "proud2"),
  ...chain(["sq_down", "sq_level", "sq_up"]), ...chain(["sb_down", "sb_level", "sb_up", "sb_high"]), ...link("sit", "sq_level", "q"), ...link("sit", "sb_level", "b"),
  ...link("sg_ahead", "sg_tilt", "y"), ...link("sq_level", "sg_tiltyou", "y"),
  ...chain(["tq_down", "tq_level", "tq_up"]), ...chain(["tb_down", "tb_level", "tb_up", "tb_high"]), ...link("stand", "tq_level", "q"), ...link("stand", "tb_level", "b"),
  ...link("tg_ahead", "tg_tilt", "y"), ...link("tq_level", "tg_tiltyou", "y"),
  ...LICK_IN, ...LICK_LOOP, ...LICK_OUT, ...CHEST_IN, ...CHEST_LOOP, ...CHEST_OUT, ...LIPS_IN, ...LIPS_LOOP, ...LIPS_OUT,
  ...PEE_IN, ...PEE_LOOP, ...POOP_IN, ...POOP_LOOP, ...SHEEPISH_IN, ...SHEEPISH_OUT,
  ...COVER_IN, ...COVER_LOOP, ...COVER_OUT, ...SHAKE_IN, ...SHAKE_OUT,
];

/**
 * Each animal's own frames (ADR-067): its drawings and the in-betweens tools/tween-own.sh makes. The
 * links off a drawing all the animals have (sit, stand, loaf) have a tag of their own per animal,
 * because BETWEEN is one list for every animal.
 */
const SHAKE = ["dshake1", "dshake2", "dshake4"] as const;
const LOAF_CHEW = link("loaf", "chew1", "x");
const CHEW_LOOP = [...dense(["chew1", "chew2"], 2), "chew1"] as SpriteKey[];
const CHEW_UP = link("chew1", "chew3", "u");
const WAG = chain(["wag1", "wag2", "wag3"]);
const PAWUP_SIT = link("sit", "pawup_sit", "u");
const SHIVER_PAW = link("shiver", "pawup", "x");
const PAWUP_DOWN = link("pawup", "sit", "x");
const PEEK_OUT = link("blanket1", "blanket2");
const DOZE_OFF = link("blanket1", "blanket3", "u");
const LISTEN = link("listen1", "listen2");
const NOSEPUSH_LOOP = [...dense(["nosepush1", "nosepush2"], 2), "nosepush1"] as SpriteKey[];
const WASH_LOOP = [...dense(["wash1", "wash2", "wash3"], 2), "wash1"] as SpriteKey[];
const RUMMAGE_LOOP = [...dense(["rummage1", "rummage2"], 2), "rummage1"] as SpriteKey[];
const HOLD_IN = link("sit", "hold1", "x");
const HOLD_NIBBLE = link("hold1", "hold2");
const THUMP_UP = link("stand", "thump1", "u");
const STAMP = link("thump1", "thump2");
const NIBBLE_LOOP = [...dense(["nibble1", "nibble2"], 2), "nibble1"] as SpriteKey[];
const EARWASH = link("earwash1", "earwash2");
const NUT_IN = link("sit", "nut3", "c");
const NUT_UP = link("nut3", "nut1");
const NUT_LOOP = [...dense(["nut1", "nut2"], 2), "nut1"] as SpriteKey[];
const CHEEKS_IN = link("nut1", "cheeks", "u");
const PAT_LOOP = [...dense(["pat1", "pat2"], 2), "pat1"] as SpriteKey[];
export const OWN_KEYS: Readonly<Record<string, readonly SpriteKey[]>> = {
  biscuit: [...new Set<SpriteKey>([...OWN_DOG, ...LOAF_CHEW, ...CHEW_LOOP, ...CHEW_UP, ...WAG])],
  chili: [...new Set<SpriteKey>([...SHAKE, ...OWN_CHIHUAHUA, ...PAWUP_SIT, ...SHIVER_PAW, ...PAWUP_DOWN, ...PEEK_OUT, ...DOZE_OFF])],
  mochi: [...new Set<SpriteKey>([...OWN_FOX, ...LISTEN, ...NOSEPUSH_LOOP])],
  bandit: [...new Set<SpriteKey>([...OWN_RACCOON, ...WASH_LOOP, ...RUMMAGE_LOOP, ...HOLD_IN, ...HOLD_NIBBLE])],
  clover: [...new Set<SpriteKey>([...OWN_RABBIT, ...THUMP_UP, ...STAMP, ...NIBBLE_LOOP, ...EARWASH])],
  hazel: [...new Set<SpriteKey>([...OWN_SQUIRREL, ...NUT_IN, ...NUT_UP, ...NUT_LOOP, ...CHEEKS_IN, ...PAT_LOOP])],
};
const OWN_SET = new Map<string, ReadonlySet<string>>(Object.entries(OWN_KEYS).map(([id, keys]) => [id, new Set<string>(keys)]));
/** The drawing that tells whether an animal has a move of its own, and what the others do instead. */
const OWN_SIGN: Partial<Record<Anim, [SpriteKey, Anim]>> = {
  shake_off: ["dshake1", "happy"], chew: ["chew1", "loaf"], wag: ["wag1", "happy"], burrow: ["blanket1", "sleep"], shiver: ["shiver", "puffed"],
  paw_up: ["pawup_sit", "idle_sit"], listen: ["listen1", "sniff"], mouse_leap: ["mouse_top", "leap"], mouse_in: ["mouse_in", "dig"],
  mouse_out: ["mouse_out", "idle_sit"], nose_push: ["nosepush1", "dig"], wash_hands: ["wash1", "groom"], inspect: ["inspect", "curious"],
  rummage: ["rummage1", "dig"], toss: ["toss", "swat"], hold: ["hold1", "beg"], binky_air: ["binky2", "bounce"], thump: ["thump1", "startled"],
  flop: ["flop1", "sprawl"], nibble: ["nibble1", "eat"], nut: ["nut1", "eat"], cheeks: ["cheeks", "proud"], pat: ["pat1", "dig"],
  flick: ["flick", "look"], cling: ["cling_up", "dangle"], cling_down: ["cling_down", "dangle"],
};
/** The move as this animal can draw it: one of another animal's own moves becomes a near one of its own. */
export function ownOr(id: string, anim: Anim): Anim {
  if (!OWN_ANIMS.has(anim)) return anim;
  const sign = OWN_SIGN[anim];
  if (!sign) return anim;
  return OWN_SET.get(id)?.has(sign[0]) ? anim : sign[1];
}
const hasOwn = (id: string, key: SpriteKey): boolean => OWN_SET.get(id)?.has(key) ?? false;

/**
 * Cut from the sheets but no longer played: the rigged gaits replaced the drawn walk and run, sitting
 * no longer flicks its tail by swapping drawings, the ear scratch is a sheet of its own now, the paw
 * sheet replaced the two swat drawings, the ledge sheet the one perch drawing, the stalking crouch
 * the pounce wiggle, and the hop for joy the one hop drawing.
 */
const RETIRED = new Set<SpriteKey>([
  "walk_a", "walk_b", "tail_a", "tail_b", "walk1", "walk2", "walk3", "walk4", "walk5", "walk6", "walk7", "walk8", "run1", "run2", "run3", "run4", "run5", "run6", "scratch",
  "swat_a", "swat_b", "perch", "wiggle_a", "wiggle_b", "hop",
]);

/** Every frame that gets loaded and played. */
export const SPRITE_KEYS: SpriteKey[] = [
  ...new Set<SpriteKey>([
    ...BASE, ...WALK, ...RUN, ...FACE, ...ACTION, ...LIFE, ...EXTRA, ...GROOM, ...SPIN, ...SEQ, ...TRANS, ...REACT, ...PLAY, ...SCRATCH, ...TURN, ...PAW,
    ...LOOK, ...LOOKSTAND, ...LEDGE, ...RESTING, ...JOYFUL, ...NOSE, ...VOICE, ...MOOD, ...FEEL, ...GAZE, ...GAZESTAND, ...LICK, ...POTTY, ...MADE, ...GW, ...GT, ...GR,
  ]),
].filter((k) => !RETIRED.has(k));

/** Frames that follow each other inside one loop and swap without a glide: they swap without a cross-fade too. */
const LOOPS: readonly (readonly SpriteKey[])[] = [GW, GT, GR, SPIN];
const loopOf = new Map<SpriteKey, number>(LOOPS.flatMap((keys, i) => keys.map((k) => [k, i] as [SpriteKey, number])));

/** Characters that have sprite art. The folder is public/sprites/<id>/. */
const SPRITE_CHARACTERS = new Set(["tabby", "inky", "pearl", "mochi", "bandit", "biscuit", "chili", "clover", "hazel"]);

/** Cat units per sprite pixel: a sitting sprite ends up about as tall as the code-drawn cat. */
const K = 0.3;

export interface SpriteSet {
  id: string;
  img: Record<SpriteKey, HTMLImageElement>;
}

const sets = new Map<string, SpriteSet | "none">();
const loading = new Map<string, Promise<void>>();

/** Where a frame's file is: next to the page (the playground and the dev server). */
export const SPRITE_URL = (id: string, key: string): string => `./sprites/${id}/${key}.webp`;
let spriteUrl: Promise<(id: string, key: string) => string> = Promise.resolve(SPRITE_URL);
let loaded: ((id: string, missing: number, usable: boolean) => void) | null = null;

/**
 * Elsewhere: the Mac app keeps the drawings once in its Resources folder, not inside the program.
 * Loading waits for the promise, so set it before the first frame is drawn.
 */
export function setSpriteUrl(url: Promise<(id: string, key: string) => string>): void {
  spriteUrl = url;
}

/** Told once a character's set has loaded: how many frames are missing and whether it can be drawn. */
export function onSpriteSet(cb: (id: string, missing: number, usable: boolean) => void): void {
  loaded = cb;
}

function loadImage(src: string, el: HTMLImageElement, tries = 2): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    el.onload = (): void => resolve(true);
    el.onerror = (): void => {
      if (tries > 1) setTimeout(() => void loadImage(src, el, tries - 1).then(resolve), 150);
      else resolve(false);
    };
    el.src = src;
  });
}

function load(id: string): Promise<void> {
  const have = loading.get(id);
  if (have) return have;
  const img = {} as Record<SpriteKey, HTMLImageElement>;
  // A few hundred frames: ask for them a few at a time (a dev server drops a flood), and retry a failure once.
  const all = [...SPRITE_KEYS, ...(OWN_KEYS[id] ?? [])];
  const queue = [...all];
  const results: boolean[] = [];
  const worker = async (): Promise<void> => {
    const url = await spriteUrl;
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      const el = new Image();
      img[key] = el;
      results.push(await loadImage(url(id, key), el));
    }
  };
  const done = Promise.all(Array.from({ length: 12 }, worker)).then(() => {
    // A missing frame is drawn as the drawing it comes from (see frameOf); only without the two
    // base drawings is the set no use.
    const ok = (k: SpriteKey): boolean => (img[k]?.naturalWidth ?? 0) > 0;
    const missing = all.filter((k) => !ok(k));
    if (missing.length) console.warn(`sprites/${id}: ${missing.length} frames missing, drawn as their nearest drawing: ${missing.slice(0, 12).join(" ")}${missing.length > 12 ? " ..." : ""}`);
    const usable = results.length > 0 && ok("sit") && ok("stand");
    sets.set(id, usable ? { id, img } : "none");
    loaded?.(id, missing.length, usable);
  });
  loading.set(id, done);
  return done;
}

/** The sprite set for a character once every image has loaded, else null (draw it in code). */
export function getSprites(id: string): SpriteSet | null {
  if (!SPRITE_CHARACTERS.has(id) || typeof Image === "undefined") return null;
  const have = sets.get(id);
  if (have && have !== "none") return have;
  if (!have) void load(id);
  return null;
}

/** True while a character that has sprites is still loading them (draw nothing rather than the old art). */
export function spritesPending(id: string): boolean {
  if (!SPRITE_CHARACTERS.has(id) || typeof Image === "undefined") return false;
  return sets.get(id) === undefined;
}

/** Resolves when the sprites of every character that has them are loaded (or have failed). */
export function spritesReady(): Promise<void> {
  if (typeof Image === "undefined") return Promise.resolve();
  return Promise.all([...SPRITE_CHARACTERS].map(load)).then(() => undefined);
}

/** How a pose moves in code, on top of the drawn frames. */
interface Motion {
  /** Breathing: how much the body squashes and stretches, and how fast. */
  breath: number;
  breathHz: number;
  /** A hop on every step (cat units) and the step rate in steps per second. */
  bounce: number;
  stepHz: number;
  /** Leaning forward while moving, in radians. */
  lean: number;
  /** A rhythmic side to side rock, in radians, and its speed. */
  wobble: number;
  wobbleHz: number;
  /** Now and then a small shift of weight, so a resting cat never looks stuffed. */
  fidget: boolean;
}

const M = (o: Partial<Motion>): Motion => ({ breath: 0.02, breathHz: 2.2, bounce: 0, stepHz: 0, lean: 0, wobble: 0, wobbleHz: 0, fidget: false, ...o });

/** What to draw: a frame, or a glide from it to the next one, `mix` of the way there. */
export interface Shot {
  key: SpriteKey;
  next: SpriteKey | null;
  mix: number;
  /** A quick shake of the head, in radians (after scratching an ear). */
  shake?: number;
  /** Off the ground, in sprite pixels (a hop for joy, a jump back). */
  lift?: number;
}

export interface SpritePlan {
  key: SpriteKey;
  /** A glide to this frame, `mix` of the way (a loop of in-betweens). */
  next?: SpriteKey | null;
  mix?: number;
  /** Frames of the same group do not pop when they swap (a walk cycle, or blinking while sitting). */
  group: string;
  /** Radians, around the feet. */
  rot?: number;
  /** Turned the other way (looking away from you). */
  flip?: boolean;
  /** The whole body rocks around its middle (chasing its tail). */
  spin?: boolean;
  /** The whole body turns over and over around its middle (a somersault). */
  roll?: boolean;
  /** Where the head is, as a share of the sprite's width and height from its bottom centre. */
  head: { x: number; y: number };
  motion: Motion;
  /** Seconds the cross-fade into a new frame of this pose takes (default 0.24). */
  fade?: number;
}

const HEAD_SIT = { x: 0.1, y: 0.78 };
const HEAD_SIDE = { x: 0.3, y: 0.72 };
const HEAD_LOW = { x: 0.2, y: 0.6 };

const REST = M({ breath: 0.022, fidget: true });
const LOAF = M({ breath: 0.03, fidget: true });
const STILL = M({ breath: 0.015 });

const smooth = (u: number): number => u * u * (3 - 2 * u);
const still = (key: SpriteKey): Shot => ({ key, next: null, mix: 0 });

/** The frame at `phase` (0 to 1) of a cycle. */
const pick = <T extends SpriteKey>(names: readonly T[], phase: number): T => names[Math.floor(phase * names.length) % names.length] as T;

/** Plays `names` in a loop at `fps` frames a second. */
const cycle = <T extends SpriteKey>(names: readonly T[], t: number, fps: number): T => names[Math.floor(t * fps) % names.length] as T;

/**
 * The point `u` (0 to 1) along a run of frames, gliding between neighbours. `band` is the share of
 * the way from one frame to the next spent blending the two: 1 blends all the way (right for frames
 * that hardly differ, like a nod), less shows each frame clean and only blends round the change, so a
 * paw that moves far never shows as two see-through paws.
 */
function along(keys: readonly SpriteKey[], u: number, band = 1): Shot {
  if (keys.length < 2) return still(keys[0] as SpriteKey);
  const x = Math.max(0, Math.min(1, u)) * (keys.length - 1);
  const i = Math.min(keys.length - 2, Math.floor(x));
  const f = x - i;
  const mix = band >= 1 ? f : smooth(Math.max(0, Math.min(1, (f - (1 - band) / 2) / band)));
  return { key: keys[i] as SpriteKey, next: keys[i + 1] as SpriteKey, mix };
}

/** A stretch of a little program: how long it lasts and what it shows `u` (0 to 1) of the way through. */
interface Seg {
  sec: number;
  at: (u: number) => Shot;
}
const hold = (key: SpriteKey, sec: number, shake = 0): Seg => ({ sec, at: () => (shake ? { ...still(key), shake } : still(key)) });
/** How much of each step a move between two different drawings spends blending (see along). */
const FAR = 0.2;
/** Through a run of frames, slow at both ends unless `even`. `band` as in along. */
const move = (keys: readonly SpriteKey[], sec: number, even = false, band = FAR): Seg => ({ sec, at: (u) => along(keys, even ? u : smooth(u), band) });

/** Through a run of frames one at a time, without blending (for drawings far apart), slow at both ends. */
const steps = (keys: readonly SpriteKey[], sec: number): Seg => ({ sec, at: (u) => still(keys[Math.min(keys.length - 1, Math.round(smooth(u) * (keys.length - 1)))] as SpriteKey) });

/** The shot `e` seconds into a program, or null once it is over. */
function play(segs: readonly Seg[], e: number): Shot | null {
  let at = 0;
  for (const s of segs) {
    if (e < at + s.sec) return s.at(Math.max(0, (e - at) / s.sec));
    at += s.sec;
  }
  return null;
}

/** How long a program lasts. */
export const lengthOf = (segs: readonly Seg[]): number => segs.reduce((a, s) => a + s.sec, 0);

/** A number in [0, 1) made from `n`, the same every time. */
const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A small seeded random source (mulberry32), so a program is the same in every window. */
function rng(seed: number): () => number {
  let a = Math.floor(seed * 4294967296) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

/**
 * Idle events that follow the clock but come at uneven times, like an animal's. Time is cut into
 * slots of `every` seconds; a slot holds one event of `len` seconds at a random place in it, or none
 * (it has one with chance `p`), so on average one comes every `every / p` seconds. While an event is
 * on it returns its slot number and how many seconds into it we are, else null. `seed` keeps
 * different kinds of event apart.
 */
function eventAt(t: number, every: number, len: number, seed: number, p = 1): { k: number; into: number } | null {
  const k = Math.floor(t / every);
  if (hash(k * 3.1 + seed) >= p) return null;
  const into = t - k * every - hash(k * 7.7 + seed * 1.3) * (every - len);
  return into >= 0 && into < len ? { k, into } : null;
}

/** Whether an event of eventAt (the same `every`, `len`, `seed` and `p`) comes anywhere between `a` and `b`. */
function eventBetween(a: number, b: number, every: number, len: number, seed: number, p = 1): boolean {
  for (let k = Math.floor(a / every); k <= Math.floor(b / every); k++) {
    if (hash(k * 3.1 + seed) >= p) continue;
    const start = k * every + hash(k * 7.7 + seed * 1.3) * (every - len);
    if (start < b && start + len > a) return true;
  }
  return false;
}

/** Sleeping: slow breathing between two frames, and about once a minute a dream. */
function sleeping(t: number): SpriteKey {
  if (eventAt(t, 40, 3, 5, 0.6)) return "sleep_c";
  return (t * 0.45) % 1 < 0.5 ? "sleep" : "sleep_b";
}

/** Turning half round to face you, a slow blink (a cat's "I trust you"), and back. */
const HALF_TURN = TURN_STEPS.sit.slice(0, TURN_STEPS.sit.indexOf("turn_t3") + 1);
const SLOW_BLINK: Seg[] = [
  steps(HALF_TURN, 0.6), hold("turn_t3", 0.5), move(["turn_t3", "slow_blink"], 0.35, false, 1), hold("slow_blink", 1.1),
  move(["slow_blink", "turn_t3"], 0.3, false, 1), hold("turn_t3", 0.4), steps([...HALF_TURN].reverse(), 0.6),
];
export const SLOW_BLINK_SEC = lengthOf(SLOW_BLINK);

/** Looks held for a while when sitting. */
export const LOOKS: ReadonlySet<SpriteKey> = new Set<SpriteKey>(["yawn", "lookup", "curious", "proud"]);

/**
 * A sitting cat is calm and mostly still (it breathes). About once every 45 s it looks up, tilts its
 * head, looks proud or yawns, and holds it for 3 s. About every two and a half minutes it turns to
 * you and gives you a slow blink. It blinks about four times a minute, at uneven times, and now and
 * then twice. Real cats blink far less, but a cartoon that never blinks looks stuffed. All of it
 * follows the clock, so every window shows the same thing.
 */
function sitting(t: number): Shot {
  const fond = eventAt(t, 75, SLOW_BLINK_SEC, 11, 0.5);
  if (fond && !eventBetween(t - fond.into, t - fond.into + SLOW_BLINK_SEC, 22, 3, 1, 0.5)) return play(SLOW_BLINK, fond.into) ?? still("sit");
  const look = eventAt(t, 22, 3, 1, 0.5);
  if (look) {
    // The head turns to look up, up high, down or at you and comes back, or a held face (a yawn, a
    // tilt of the head, smug).
    const r = hash(look.k * 5.3 + 2);
    if (r < 0.12) return still("yawn");
    if (r < 0.24) return play(GLANCE_UP, look.into) ?? still("sit");
    if (r < 0.3) return play(GLANCE_HIGH, look.into) ?? still("sit");
    if (r < 0.4) return play(GLANCE_DOWN, look.into) ?? still("sit");
    if (r < 0.5) return play(GLANCE_YOU, look.into) ?? still("sit");
    if (r < 0.6) return play(GLANCE_BACK, look.into) ?? still("sit");
    if (r < 0.64) return play(TILT, look.into) ?? still("sit");
    if (r < 0.68) return play(LIP_LICK, look.into) ?? still("sit");
    return still(r < 0.86 ? "curious" : "proud");
  }
  // An ear turns towards a sound about every half minute.
  const ear = eventAt(t, 16, lengthOf(EAR_TWITCH), 6, 0.5);
  if (ear) return play(EAR_TWITCH, ear.into) ?? still("sit");
  const b = eventAt(t, 12, 0.75, 3, 0.9);
  if (b && (b.into < 0.18 || (hash(b.k * 9.1 + 4) < 0.25 && b.into > 0.45 && b.into < 0.63))) return still("blink");
  return still("sit");
}

/** Plays a loop of frames (the last one equal to the first) `hz` times a second, gliding. */
const loopAt = (keys: readonly SpriteKey[], t: number, hz: number): Pick<SpritePlan, "key" | "next" | "mix"> => along(keys, (t * hz) % 1);

/** A meow: the mouth opens, holds and closes, about once a second. A call is the same, bigger. */
const MEOWING: Seg[] = [move(MEOW, 0.18, false, 1), hold("meow", 0.38), move([...MEOW].reverse(), 0.22, false, 1), hold("sit", 0.47)];
const CALLING: Seg[] = [move(link("sit", "meow2", "w"), 0.2, false, 1), hold("meow2", 0.45), move(rev(link("sit", "meow2", "w")), 0.25, false, 1), hold("sit", 0.35)];

/**
 * `phase` is how far through a walking or running cycle the cat is (0 to 1), driven by distance walked.
 * `trot` swaps the walk for a trot (a fast walker trots, like a dog or a fox does). The gait frames
 * already bob and sway, so no bounce is added in code. Washing, the ear scratch and turning round are
 * programs that depend on when they began, so drawSprite plays those (this gives their first frame).
 */
export function planFor(anim: Anim, t: number, vy = 0, phase = 0, trot = false, id = ""): SpritePlan {
  const rabbit = id === "clover";
  anim = ownOr(id, anim);
  switch (anim) {
    case "keyboard": return { key: pick(GW, phase), group: "walk", head: HEAD_SIDE, motion: M({ breath: 0 }) };
    case "walk": return { key: pick(trot ? GT : GW, phase), group: trot ? "trot" : "walk", head: HEAD_SIDE, motion: M({ breath: 0, lean: trot ? 0.01 : 0 }) };
    case "run": return { key: pick(GR, phase), group: "run", head: HEAD_SIDE, motion: M({ breath: 0, lean: 0.02 }) };
    case "jump": return { key: vy > 80 ? "fall" : "jump", group: "air", head: HEAD_SIDE, motion: M({ breath: 0 }) };
    case "fall": return { key: "fall", group: "air", head: HEAD_SIDE, motion: M({ breath: 0 }) };
    case "land": return { key: "land", group: "land", head: HEAD_LOW, motion: M({ wobble: 0.02, wobbleHz: 14 }) };
    case "prep": return { key: "prep", group: "prep", head: HEAD_LOW, motion: M({ breath: 0.02, breathHz: 7 }), fade: 0.1 };
    case "dangle": return { key: "dangle", group: "dangle", head: HEAD_SIT, motion: M({ wobble: 0.05, wobbleHz: 5, breath: 0.01 }) };
    case "peek": return { ...idleWith(t, "peek", PEEKING), group: "peek", head: { x: 0.15, y: 0.6 }, motion: M({ breath: 0.02 }) };
    case "box": return { key: "box", group: "box", head: { x: 0.0, y: 0.8 }, motion: M({ breath: 0.015, wobble: 0.01, wobbleHz: 2 }) };
    case "perch": return { ...idleWith(t, "perch_fwd", PERCHING, swinging), group: "perch", head: HEAD_SIT, motion: M({ breath: 0.02, fidget: true }) };
    case "stretch": return { key: "stretch", group: "stretch", head: HEAD_LOW, motion: M({ breath: 0.035, breathHz: 3 }) };
    // Sitting, a paw reaches out and taps (or pushes), and a swat. Programs: see pawShot.
    case "push_toy": return { key: "paw1", group: "push", head: HEAD_SIT, motion: M({ breath: 0.015 }) };
    case "swat": return { key: "paw1", group: "swat", head: HEAD_SIT, motion: M({ breath: 0.015 }) };
    case "pounce": return { key: "stalk1", group: "pounce", head: HEAD_LOW, motion: M({ breath: 0.02, breathHz: 5 }), fade: 0.12 };
    // Heaving: hunched and crouched by turns, a little over once a second.
    case "hairball": return { ...loopAt(RETCH, t, 1.25), group: "retch", head: HEAD_LOW, motion: M({ wobble: 0.02, wobbleHz: 30, breath: 0.04, breathHz: 12 }) };
    case "sleep": return { key: sleeping(t), group: "sleep", head: HEAD_LOW, motion: M({ breath: 0.015, breathHz: 2 }), fade: 0.8 };
    // Kneading: one paw and then the other pushes down, about once a second each.
    case "knead": return { ...loopAt(KNEAD, t, 0.55), group: "knead", head: HEAD_LOW, motion: M({ breath: 0.03, breathHz: 5 }) };
    case "loaf": return { ...idleWith(t, "loaf", LOAFING), group: "loaf", head: HEAD_LOW, motion: LOAF };
    case "sulk": return { key: "sulk", group: "sulk", head: HEAD_SIT, motion: M({ breath: 0.02 }) };
    case "groom": return { key: "groom1", group: "groom", head: HEAD_SIT, motion: M({ breath: 0.015, breathHz: 2.5 }) };
    case "happy": return { key: "hop_crouch", group: "happy", head: HEAD_SIT, motion: M({ breath: 0.02 }), fade: 0.18 };
    case "gift": return { key: "gift", group: "gift", head: HEAD_SIDE, motion: M({ breath: 0.02, fidget: true }) };
    case "purr": return { key: cycle(["joy", "love"] as const, t, 0.5), group: "sit", head: HEAD_SIT, motion: M({ breath: 0.035, breathHz: 6, wobble: 0.012, wobbleHz: 28 }), fade: 0.6 };
    case "headbutt": return { key: "rub", group: "rub", head: HEAD_LOW, motion: M({ breath: 0.03, breathHz: 5 }) };
    case "sneeze": return { key: "sneeze", group: "sneeze", head: HEAD_SIT, motion: M({ wobble: 0.04, wobbleHz: 44, breath: 0.04, breathHz: 9 }) };
    // A meow about once a second, and every third one a big call.
    case "meow": return { ...(play(Math.floor(t / lengthOf(MEOWING)) % 3 === 2 ? CALLING : MEOWING, t % lengthOf(MEOWING)) ?? still("sit")), group: "sit", head: HEAD_SIT, motion: REST };
    // Chattering at a bird: eyes up high, the jaw going fast (see poseShot).
    case "chatter": return { key: "sg_high", group: "chatter", head: HEAD_SIT, motion: M({ wobble: 0.01, wobbleHz: 30, breath: 0.03, breathHz: 8 }) };
    case "look": return { key: "sg_up", group: "look", head: HEAD_SIT, motion: REST };
    case "stare": return { key: "surprise", group: "sit", head: HEAD_SIT, motion: STILL };
    case "blink": return { key: "blink", group: "sit", head: HEAD_SIT, motion: REST };
    case "turn_away": return { key: "back", group: "back", head: HEAD_SIT, motion: M({ breath: 0.02, fidget: true }) };
    case "chase_tail": return { key: cycle(SPIN, t, 9), group: "chase", head: HEAD_SIT, motion: M({ breath: 0 }) };
    case "angry": return { key: "cross", group: "angry", head: HEAD_SIDE, motion: M({ wobble: 0.006, wobbleHz: 24, breath: 0.03, breathHz: 7 }) };
    case "hiss": return { key: "cross", group: "hiss", head: HEAD_SIDE, motion: M({ wobble: 0.01, wobbleHz: 30, breath: 0.035, breathHz: 9 }), fade: 0.12 };
    case "puffed": return { key: "puff1", group: "puffed", head: HEAD_SIDE, motion: M({ wobble: 0.01, wobbleHz: 38, breath: 0.03, breathHz: 10 }) };
    case "annoyed": return { key: "annoyed", group: "annoyed", head: HEAD_SIT, motion: M({ breath: 0.02, breathHz: 3 }) };
    case "flustered": return { key: "flustered", group: "flustered", head: HEAD_SIT, motion: M({ wobble: 0.015, wobbleHz: 26, breath: 0.03, breathHz: 8 }) };
    case "play_bow": return { key: "bow_down", group: "bow", head: HEAD_LOW, motion: M({ wobble: 0.02, wobbleHz: 13, breath: 0.03, breathHz: 6 }) };
    case "leap": return { key: "leap", group: "air", head: HEAD_SIDE, motion: M({ breath: 0 }) };
    // Hanging off a ledge by the front paws after a jump that fell short: the leap drawing tilted nose
    // up, back legs scrabbling (the quick rock).
    case "hang": return { key: "leap", group: "hang", head: HEAD_SIDE, rot: -1.2, motion: M({ wobble: 0.05, wobbleHz: 8, breath: 0 }) };
    // Bouncing about: up and coming down (a rabbit twists in the air: a binky).
    case "bounce": return { key: vy > 120 ? "hop_land" : rabbit ? "binky" : "hop_up", group: "air", head: HEAD_SIT, motion: M({ breath: 0 }), fade: 0.1 };
    case "belly": return { key: "belly", group: "belly", head: HEAD_LOW, motion: M({ breath: 0.03, breathHz: 4 }) };
    case "bark": return { key: "sit", group: "bark", head: HEAD_SIT, motion: M({ breath: 0.03, breathHz: 8 }), fade: 0.1 };
    case "shy": return { key: "shy", group: "shy", head: HEAD_SIT, motion: M({ breath: 0.02 }) };
    case "beg": return { key: "beg", group: "beg", head: HEAD_SIT, motion: M({ breath: 0.025, breathHz: 5 }) };
    case "dig": return { key: "dig1", group: "dig", head: HEAD_LOW, motion: M({ breath: 0.02 }) };
    case "sniff": return { key: "sniff1", group: "sniff", head: HEAD_LOW, motion: M({ breath: 0.03, breathHz: 9 }) };
    case "eat": return { key: "sniff2", group: "eat", head: HEAD_LOW, motion: M({ breath: 0.02, breathHz: 4 }) };
    case "tumble": return { key: "tumble", group: "tumble", head: HEAD_SIT, roll: true, motion: M({ breath: 0 }) };
    case "sprawl": return { ...idleWith(t, "sprawl", SPRAWLING), group: "sprawl", head: HEAD_LOW, motion: M({ breath: 0.025, breathHz: 2 }) };
    case "howl": return { key: "sit", group: "howl", head: HEAD_SIT, motion: M({ breath: 0.04, breathHz: 2.4 }) };
    case "giggle": return { key: "giggle1", group: "giggle", head: HEAD_SIT, motion: M({ wobble: 0.02, wobbleHz: 21, bounce: 1, stepHz: 6, breath: 0.03 }) };
    case "startled": return { key: "jumpback", group: "startled", head: HEAD_SIDE, motion: M({ wobble: 0.008, wobbleHz: 32, breath: 0.03, breathHz: 10 }), fade: 0.1 };
    case "proud": return { key: "proud", group: "proud", head: HEAD_SIT, motion: STILL };
    case "curious": return { key: "curious", group: "curious", head: HEAD_SIT, motion: REST };
    case "love": return { key: cycle(["love", "joy"] as const, t, 0.7), group: "sit", head: HEAD_SIT, motion: M({ breath: 0.035, breathHz: 5 }), fade: 0.4 };
    case "yawn": return { key: "yawn", group: "sit", head: HEAD_SIT, motion: M({ breath: 0.04, breathHz: 1.6 }) };
    case "lick_lips": return { key: "lips1", group: "lick_lips", head: HEAD_SIT, motion: REST };
    // It has to go (ADR-048). Programs: see poseShot, and the look back in sequenceShot.
    case "pee": return { key: "pee1", group: "pee", head: HEAD_SIDE, motion: M({ breath: 0.015, breathHz: 1.8 }) };
    case "poop": return { key: "poop1", group: "poop", head: HEAD_SIDE, motion: M({ breath: 0.02, breathHz: 3 }) };
    case "potty_look": return { key: "pottyback", group: "potty_look", head: HEAD_SIDE, motion: STILL };
    case "cover": return { key: "cover1", group: "cover", head: HEAD_LOW, motion: M({ breath: 0.02, breathHz: 4 }) };
    case "paw_shake": return { key: "pawshake", group: "paw_shake", head: HEAD_SIDE, motion: STILL };
    case "surprise": return { key: "surprise", group: "sit", head: HEAD_SIT, motion: M({ wobble: 0.01, wobbleHz: 20, breath: 0.03 }) };
    case "dazed": return { key: "dazed", group: "sit", head: HEAD_SIT, motion: M({ wobble: 0.05, wobbleHz: 4, breath: 0.02 }) };
    case "scratch": return { key: "scratch1", group: "scratch", head: HEAD_SIT, motion: M({ breath: 0.015 }) };
    // Following the cursor with the head (see gazeShot), or looking round when there is none.
    case "watch": return { key: "sg_ahead", group: "watch", head: HEAD_SIT, motion: REST };
    case "watch_stand": return { key: "tg_ahead", group: "watch_stand", head: HEAD_SIDE, motion: M({ breath: 0.02 }) };
    // Each animal's own moves (ADR-067). Programs: see poseShot.
    // About one frame of blend between the fast swaps: crisp, like a cartoon, with no double image.
    case "shake_off": return { key: "dshake1", group: "shake_off", head: HEAD_SIDE, motion: M({ breath: 0 }), fade: 0.02 };
    case "wag": return { key: "wag1", group: "wag", head: HEAD_SIDE, motion: M({ breath: 0.03, breathHz: 6 }), fade: 0.2 };
    case "chew": return { key: "chew1", group: "chew", head: HEAD_LOW, motion: M({ breath: 0.02, breathHz: 2.4 }) };
    case "burrow": return { key: "blanket1", group: "burrow", head: HEAD_LOW, motion: M({ breath: 0.02, breathHz: 1.6 }), fade: 0.3 };
    // Trembling: a fine fast shiver all over, the breath quick.
    case "shiver": return { key: "shiver", group: "shiver", head: HEAD_SIDE, motion: M({ wobble: 0.012, wobbleHz: 17, breath: 0.03, breathHz: 7 }), fade: 0.22 };
    case "paw_up": return { key: "pawup_sit", group: "paw_up", head: HEAD_SIT, motion: M({ breath: 0.02 }) };
    case "listen": return { key: "listen1", group: "listen", head: HEAD_LOW, motion: M({ breath: 0.012 }), fade: 0.3 };
    // The fox's leap: going up, at the top, coming down nose first.
    case "mouse_leap": return { key: vy < -260 ? "mouse_up" : vy < 380 ? "mouse_top" : "mouse_dive", group: "mouse_air", head: HEAD_SIDE, motion: M({ breath: 0 }), fade: 0.08 };
    // In the ground to the shoulders, the back end wiggling.
    case "mouse_in": return { key: "mouse_in", group: "mouse_in", head: HEAD_LOW, motion: M({ wobble: 0.018, wobbleHz: 8, breath: 0 }), fade: 0.06 };
    case "mouse_out": return { key: "mouse_out", group: "mouse_out", head: HEAD_SIDE, motion: M({ breath: 0.025 }), fade: 0.12 };
    case "nose_push": return { key: "nosepush1", group: "nose_push", head: HEAD_LOW, motion: M({ breath: 0.02, breathHz: 4 }) };
    case "wash_hands": return { key: "wash1", group: "wash_hands", head: HEAD_LOW, motion: M({ breath: 0.015 }), fade: 0.3 };
    case "inspect": return { key: "inspect", group: "inspect", head: HEAD_SIT, motion: REST };
    case "rummage": return { key: "rummage1", group: "rummage", head: HEAD_LOW, motion: M({ wobble: 0.01, wobbleHz: 6, breath: 0.02, breathHz: 4 }) };
    case "toss": return { key: "toss", group: "toss", head: HEAD_SIT, motion: STILL, fade: 0.1 };
    case "hold": return { key: "hold1", group: "hold", head: HEAD_SIT, motion: REST };
    // The binky's twist: one way going up, the other coming down.
    case "binky_air": return { key: vy < 0 ? "binky" : "binky2", group: "binky_air", head: HEAD_SIT, motion: M({ breath: 0 }), fade: 0.1 };
    case "thump": return { key: "thump1", group: "thump", head: HEAD_SIDE, motion: STILL, fade: 0.2 };
    case "flop": return { key: "flop2", group: "flop", head: HEAD_LOW, motion: M({ breath: 0.025, breathHz: 1.6 }), fade: 0.2 };
    case "nibble": return { key: "nibble1", group: "nibble", head: HEAD_LOW, motion: M({ breath: 0.015 }) };
    case "nut": return { key: "nut1", group: "nut", head: HEAD_SIT, motion: M({ breath: 0.02, breathHz: 4 }) };
    case "cheeks": return { key: "cheeks", group: "cheeks", head: HEAD_SIT, motion: M({ breath: 0.03, breathHz: 5 }) };
    case "pat": return { key: "pat1", group: "pat", head: HEAD_LOW, motion: M({ breath: 0.02 }) };
    case "flick": return { key: "stand", group: "flick", head: HEAD_SIDE, motion: M({ breath: 0.02 }), fade: 0.1 };
    case "cling": return { key: "cling_up", group: "cling", head: HEAD_SIT, motion: M({ breath: 0.02, breathHz: 4 }), fade: 0.12 };
    case "cling_down": return { key: "cling_down", group: "cling_down", head: HEAD_LOW, motion: M({ breath: 0.02, breathHz: 4 }), fade: 0.12 };
    default: return { ...sitting(t), group: "sit", head: HEAD_SIT, motion: REST };
  }
}

/** Licks a second while washing: Noel and Hu (2018) measured 1.4 ± 0.6 tongue strokes a second in cats. */
export const LICK_HZ = 1.4;
/** Strokes a second of the ear scratch: the scratch reflex runs at 4 to 8 a second, about 5.6 on average. */
export const SCRATCH_HZ = 5.6;

/**
 * Licks with the tongue drawn moving (the lick sheet): from the paw at the mouth into the tongue
 * cycle, `n` strokes (now and then a short pause between two), and back to the paw. The chest the same.
 */
function tongue(segs: Seg[], part: "paw" | "chest", n: number, hz: number, r: () => number): void {
  const [into, loop, out, rest] = part === "paw" ? [LICK_IN, LICK_LOOP, LICK_OUT, "lick1"] : [CHEST_IN, CHEST_LOOP, CHEST_OUT, "chest1"];
  segs.push(move(into, 0.18));
  for (let i = 0; i < n; i++) {
    segs.push(move(loop, (1 / hz) * (0.85 + 0.3 * r()), true));
    if (i < n - 1 && r() < 0.2) segs.push(hold(rest as SpriteKey, 0.2 + 0.4 * r()));
  }
  segs.push(move(out, 0.18));
}

/** Licks with one drawing nodding, `n` of them, now and then a short pause between two. */
function licks(segs: Seg[], key: SpriteKey, n: number, hz: number, r: () => number): void {
  const path = nodOf(key);
  for (let i = 0; i < n; i++) {
    segs.push(move(path, (1 / hz) * (0.85 + 0.3 * r()), true, 1));
    if (i < n - 1 && r() < 0.2) segs.push(hold(key, 0.2 + 0.4 * r()));
  }
}

/**
 * How each animal washes: how many licks of a paw before it washes its face, and how many times it
 * wipes its face. Cats wipe two to four times, the fox less, the raccoon fusses over its paws, the
 * puppies lick a paw but do not wash their face with it, the rabbit pulls an ear down and licks it
 * (its "face" frames), and the squirrel scrubs its face with both hands a lot.
 */
const WASH: Record<string, { paw: [number, number]; face: [number, number] }> = {
  mochi: { paw: [3, 6], face: [1, 2] },
  bandit: { paw: [5, 9], face: [2, 3] },
  biscuit: { paw: [4, 7], face: [0, 0] },
  chili: { paw: [3, 6], face: [0, 0] },
  clover: { paw: [2, 4], face: [2, 3] },
  hazel: { paw: [3, 5], face: [3, 4] },
};
const CAT_WASH: { paw: [number, number]; face: [number, number] } = { paw: [3, 6], face: [2, 4] };

/**
 * One bout of washing, head first and working down the body, the way cats do: lick a paw a few
 * times, wipe it over the ear and down the cheek (licking the paw again between wipes), lick the
 * nose, then the chest, then a hind leg, and end with a content blink. Each part goes on for a
 * while before it moves to the next one, and it never goes back and forth.
 */
export function groomBout(id: string, r: () => number, first: boolean): Seg[] {
  const w = WASH[id] ?? CAT_WASH;
  const hz = LICK_HZ * (0.85 + 0.3 * r());
  const segs: Seg[] = [];
  if (!first) segs.push(move(link("groom9", "groom1"), 0.5));
  segs.push(move(link("groom1", "groom2"), 0.45));
  tongue(segs, "paw", between(r, ...w.paw), hz, r);
  const wipes = between(r, ...w.face);
  for (let i = 0; i < wipes; i++) {
    // The paw goes over the ear, behind it and down the cheek.
    segs.push(move(link("groom2", "groom3"), 0.35), hold("groom3", 0.12), move(link("groom3", "groom4"), 0.35), hold("groom4", 0.15), move(link("groom4", "groom5"), 0.4), hold("groom5", 0.1));
    if (i < wipes - 1) {
      segs.push(move(link("groom5", "groom2", "u"), 0.35));
      tongue(segs, "paw", between(r, 1, 3), hz, r);
    }
  }
  // A rabbit pulls an ear down with both front paws and licks it (its own drawings, ADR-067).
  // Then straight on to the nose (a cross-fade, as between any two poses that don't glide).
  const ears = hasOwn(id, "earwash1") && r() < 0.85;
  if (ears) {
    segs.push(hold("earwash1", 0.4));
    const n = between(r, 3, 6);
    for (let i = 0; i < n; i++) segs.push(move(EARWASH, 0.28 * (0.9 + 0.2 * r())), move(rev(EARWASH), 0.3 * (0.9 + 0.2 * r())));
    segs.push(hold("earwash1", 0.35));
  } else segs.push(wipes > 0 ? move(link("groom5", "groom6"), 0.3) : move(link("groom2", "groom6", "u"), 0.4));
  licks(segs, "groom6", between(r, 1, 3), hz * 1.5, r);
  segs.push(move(link("groom6", "groom7"), 0.45));
  tongue(segs, "chest", between(r, 2, 6), hz, r);
  segs.push(move(link("groom7", "groom8"), 0.5));
  licks(segs, "groom8", between(r, 3, 8), hz, r);
  segs.push(move(link("groom8", "groom9"), 0.5), hold("groom9", 0.9 + 0.8 * r()));
  return segs;
}

/** A program that grows as it is played (a wash goes on as long as the groom does). */
interface Program {
  segs: Seg[];
  len: number;
  r: () => number;
}
const programs = new Map<string, Program>();
function programFor(key: string, seed: number): Program {
  let p = programs.get(key);
  if (!p) {
    if (programs.size > 32) programs.clear();
    programs.set(key, (p = { segs: [], len: 0, r: rng(seed) }));
  }
  return p;
}

const LONGEST_WASH = 900;

/** The shot `e` seconds into a wash: one bout after another, each a little different. `seed` picks the variation. */
export function groomShot(id: string, e: number, seed: number): Shot {
  const p = programFor(`groom/${id}/${seed}`, seed);
  // Nobody washes for a quarter of an hour, but if it ever does, the last minute repeats instead of growing forever.
  if (e > LONGEST_WASH) e = LONGEST_WASH - 60 + ((e - LONGEST_WASH) % 60);
  while (p.len <= e) {
    const bout = groomBout(id, p.r, p.segs.length === 0);
    p.segs.push(...bout);
    p.len += lengthOf(bout);
  }
  return play(p.segs, Math.max(0, e)) ?? still("groom9");
}

/**
 * Scratching an ear with a hind leg: the head tilts, the leg comes up, a burst of quick strokes (a
 * dozen or so at about 5.6 a second, the head tilting further halfway through), the leg goes down,
 * a shake of the head, and a content sit.
 */
export function scratchProgram(seed: number): Seg[] {
  // It has to fit in the time the executor holds the pose (SCRATCH_SEC): the strokes take what is left.
  const r = rng(seed);
  const hz = SCRATCH_HZ * (0.9 + 0.2 * r());
  const up: SpriteKey[] = ["scratch4", "scratch4t1", "scratch4t2", "scratch5", "scratch4t2", "scratch4t1", "scratch4"];
  const over: SpriteKey[] = ["scratch4", "scratch4t1", "scratch4t2", "scratch5", "scratch5t1", "scratch5t2", "scratch6"];
  const tilted: SpriteKey[] = ["scratch6", "scratch5t2", "scratch5t1", "scratch5", "scratch5t1", "scratch5t2", "scratch6"];
  const lift: Seg[] = [hold("scratch1", 0.3), move(link("scratch1", "scratch2"), 0.3), move(link("scratch2", "scratch3"), 0.25), move(link("scratch3", "scratch4"), 0.15)];
  const down: Seg[] = [move(link("scratch6", "scratch7"), 0.3), hold("scratch7", 0.15), move(link("scratch7", "scratch8"), 0.15), hold("scratch8", 0.45, 0.07), move(link("scratch8", "scratch9"), 0.25)];
  // A little time to spare at the end, sitting content.
  const strokes = Math.max(4, Math.floor((SCRATCH_SEC - 0.2 - lengthOf(lift) - lengthOf(down)) * hz));
  const half = Math.floor(strokes * 0.55);
  // Fast enough that blending all the way reads as a blur of the paw, which is what the eye sees.
  const burst = Array.from({ length: strokes }, (_, i) => move(i < half ? up : i === half ? over : tilted, 1 / hz, true, 1));
  return [...lift, ...burst, ...down];
}
/** The shot `e` seconds into an ear scratch. */
export function scratchShot(e: number, seed: number): Shot {
  const p = programFor(`scratch/${seed}`, seed);
  if (p.segs.length === 0) {
    p.segs = scratchProgram(seed);
    p.len = lengthOf(p.segs);
  }
  return play(p.segs, Math.max(0, e)) ?? still("scratch9");
}

/**
 * A paw reaching out to tap or push something in front of it (a mug on the window, a ball), sitting:
 * the head dips to look, the paw lifts, reaches and presses forward, comes back and is set down. The
 * paw touches about 0.4 s in. Held longer, it looks, sits back and does it again.
 */
const PUSH: Seg[] = [
  move(link("sit", "paw1", "p"), 0.15, false, 1), move(chain(["paw1", "paw2", "paw3"]), 0.25, true), move(link("paw3", "paw4"), 0.3), hold("paw4", 0.15),
  move(link("paw4", "paw5"), 0.2), move(link("paw5", "paw9"), 0.2), hold("paw9", 0.55), move(link("paw9", "sit", "p"), 0.2, false, 1),
];
/** A swat: the paw goes up beside the cheek, strikes forward and down (about 0.5 s in), and comes back to sit. */
const SWAT: Seg[] = [
  move(link("sit", "paw1", "p"), 0.1, false, 1), move(link("paw1", "paw6", "u"), 0.2), hold("paw6", 0.12), move(chain(["paw6", "paw7", "paw8"]), 0.14, true),
  hold("paw8", 0.18), move(link("paw8", "paw5", "u"), 0.25), move(link("paw5", "paw9"), 0.2), hold("paw9", 0.4), move(link("paw9", "sit", "p"), 0.2, false, 1),
];
export const PUSH_SEC = lengthOf(PUSH);
/** The shot `e` seconds into a push (it starts over while it lasts) or a swat (then it sits). */
export function pawShot(kind: "push" | "swat", e: number): Shot {
  if (kind === "push") return play(PUSH, Math.max(0, e) % PUSH_SEC) ?? still("sit");
  return play(SWAT, Math.max(0, e)) ?? still("sit");
}

/** Out along a run of frames to its last drawing, held there, and back the same way. */
const visit = (path: readonly SpriteKey[], go: number, stay: number, back = go, band = FAR): Seg[] => [
  move(path, go, false, band), hold(path[path.length - 1] as SpriteKey, stay), move([...path].reverse(), back, false, band),
];
/** A stretch of a program off the ground: `arc(u)` is the height in sprite pixels. */
const lifted = (seg: Seg, arc: (u: number) => number): Seg => ({ sec: seg.sec, at: (u) => ({ ...seg.at(u), lift: arc(u) }) });

/** An idle event: a little program that starts now and then by the clock (see eventAt). */
interface Idle {
  segs: Seg[];
  every: number;
  seed: number;
  p: number;
}
/** Holds `base` (or plays `rest` at time t), and now and then one of `events`, the first that is on. */
function idleWith(t: number, base: SpriteKey, events: readonly Idle[], rest?: (t: number) => Shot): Shot {
  for (const ev of events) {
    const on = eventAt(t, ev.every, lengthOf(ev.segs), ev.seed, ev.p);
    if (on) return play(ev.segs, on.into) ?? still(base);
  }
  return rest ? rest(t) : still(base);
}

// The head turning to follow something, sitting and standing: a chain from looking down, through
// ahead, to straight up. Position 0 is down, 1 ahead, 2 up a little, 3 up high, 4 straight up.
const GAZE_SIT = chain(["sg_down", "sg_ahead", "sg_up", "sg_high", "sg_top"]);
const GAZE_STAND = chain(["tg_down", "tg_ahead", "tg_up", "tg_high", "tg_top"]);
/** The gaze chain from ahead to `to` (a position along it), and back. */
const gazePath = (chainKeys: readonly SpriteKey[], to: number): SpriteKey[] => (to >= 1 ? chainKeys.slice(3, 3 * to + 1) : rev(chainKeys.slice(0, 4)));
/** A glance: from the sit to looking ahead, along to a gaze, held, and back. Three seconds, like the other looks. */
const glance = (to: number, stay: number): Seg[] => {
  const path = gazePath(GAZE_SIT, to);
  const go = 0.25 + 0.12 * Math.abs(to - 1);
  return [move(link("sit", "sg_ahead", "g"), 0.2, false, 1), ...visit(path, go, stay, go, 1), move(rev(link("sit", "sg_ahead", "g")), 0.2, false, 1), hold("sit", Math.max(0, 3 - 0.4 - 2 * go - stay))];
};
const GLANCE_UP = glance(2, 1.7);
const GLANCE_HIGH = glance(3, 1.3);
const GLANCE_DOWN = glance(0, 1.6);
/** A look back over the shoulder at something behind, and round again. */
const GLANCE_BACK: Seg[] = [move(link("sit", "sb_level", "b"), 0.3, false, 1), hold("sb_level", 0.9), move(chain(["sb_level", "sb_up"]), 0.3, false, 1), hold("sb_up", 0.6), move(rev(chain(["sb_level", "sb_up"])), 0.3, false, 1), move(rev(link("sit", "sb_level", "b")), 0.3, false, 1), hold("sit", 0.3)];
/** A tilt of the head at something, held, and back. */
const TILT: Seg[] = [move(link("sit", "sg_ahead", "g"), 0.2, false, 1), ...visit(link("sg_ahead", "sg_tilt", "y"), 0.3, 1.4, 0.3, 1), move(rev(link("sit", "sg_ahead", "g")), 0.2, false, 1), hold("sit", 0.3)];
/** Licking its lips: two or three quick licks round the mouth. */
const LIP_LICK: Seg[] = [move(LIPS_IN, 0.2), move(LIPS_LOOP, 0.42, true), move(LIPS_LOOP, 0.4, true), hold("lips1", 0.15), move(LIPS_LOOP, 0.45, true), move(LIPS_OUT, 0.25), hold("sit", 0.4)];
export const LIP_LICK_SEC = lengthOf(LIP_LICK);
const GLANCE_YOU: Seg[] = [move(link("sit", "sg_ahead", "g"), 0.2, false, 1), ...visit(link("sg_ahead", "sg_you", "u"), 0.35, 1.7), move(rev(link("sit", "sg_ahead", "g")), 0.2, false, 1), hold("sit", 0.2)];
const EAR_TWITCH: Seg[] = [move(link("sit", "sg_ahead", "g"), 0.15, false, 1), ...visit(link("sg_ahead", "sg_ear", "v"), 0.1, 0.25, 0.15, 1), move(rev(link("sit", "sg_ahead", "g")), 0.15, false, 1)];

/**
 * Watching something: the head goes where the thing is, the body stays. Three directions, each a
 * chain of drawings from looking down to looking up: in profile the way it faces (sg_/tg_, down to
 * straight up), three quarters toward you (sq_/tq_, for something right on it or over its head), and
 * back over the shoulder (sb_/tb_). Up and down glide along a chain; from one direction to the next
 * the head first comes level, then the drawing swaps (a quick cross-fade, like a head turning fast).
 * The head follows smoothly but not every little move (a dead band), and when the thing stops for a
 * moment it may tilt its head at it.
 */
interface Gaze {
  yaw: number;
  u: number;
  t: number;
  since: number;
  /** When it last swapped direction (a swap holds a moment before the next one). */
  swapAt: number;
  /** The target as it was, and since when it has not moved. */
  goal: { yaw: number; u: number };
  stillAt: number;
  tilt: number;
}
const gazes = new Map<string, Gaze>();
/** Directions: 0 in profile, 1 three quarters toward you, 2 over the shoulder. How far up each chain goes. */
const PITCH_TOP = [4, 2, 3] as const;
const GAZE_DIRS = {
  sit: [GAZE_SIT, chain(["sq_down", "sq_level", "sq_up"]), chain(["sb_down", "sb_level", "sb_up", "sb_high"])],
  stand: [GAZE_STAND, chain(["tq_down", "tq_level", "tq_up"]), chain(["tb_down", "tb_level", "tb_up", "tb_high"])],
} as const;
const TILTS = {
  sit: [link("sg_ahead", "sg_tilt", "y"), link("sq_level", "sg_tiltyou", "y")],
  stand: [link("tg_ahead", "tg_tilt", "y"), link("tq_level", "tg_tiltyou", "y")],
} as const;
/** Up or down from level, in degrees, as a place on a chain (1 is level): down to 0, up to `top`. */
const pitchOf = (deg: number, top: number): number => {
  const e = Math.max(-35, Math.min(95, deg));
  return e < 0 ? Math.max(0, 1 + e / 35) : Math.min(top, 1 + e / 30);
};
/**
 * Where the head should point for something `dx` ahead (in the way it faces) and `dy` above the head:
 * which way (0 in profile, 1 toward you, 2 over the shoulder) and how far up (1 is level).
 */
export function gazeTarget(dx: number, dy: number): { yaw: number; u: number } {
  // Right on it (a hand on its head): it looks at you.
  if (Math.hypot(dx, dy) < 60) return { yaw: 1, u: 1 };
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg >= -70 && deg <= 105) return { yaw: 0, u: pitchOf(deg, 4) };
  // Over its head and a little behind, or under it and a little behind: the head turns toward you.
  if (deg > 105 && deg < 140) return { yaw: 1, u: 2 };
  if (deg < -70 && deg > -115) return { yaw: 1, u: 0 };
  // Behind: how far up or down from straight back.
  return { yaw: 2, u: pitchOf(deg > 0 ? 180 - deg : -180 - deg, 3) };
}
export function gazeShot(slot: string, standing: boolean, since: number, t: number, target: { yaw: number; u: number }, tilty = 0.5): Shot {
  let g = gazes.get(slot);
  if (!g || g.since !== since) gazes.set(slot, (g = { yaw: 0, u: 1, t, since, swapAt: -9, goal: { ...target }, stillAt: t, tilt: 0 }));
  const dt = Math.max(0, Math.min(0.1, t - g.t));
  g.t = t;
  const toward = (v: number, goal: number, rate: number): number => {
    const d = goal - v;
    if (Math.abs(d) < 0.02) return goal;
    return v + Math.sign(d) * Math.min(Math.abs(d), Math.max(Math.abs(d) * rate * dt, 1.2 * dt));
  };
  // Has the thing stopped? (For the head tilt.)
  if (target.yaw !== g.goal.yaw || Math.abs(target.u - g.goal.u) > 0.08) {
    g.goal = { ...target };
    g.stillAt = t;
  }
  const still = t - g.stillAt;
  const kind = standing ? "stand" : "sit";
  if (target.yaw !== g.yaw) {
    g.tilt = toward(g.tilt, 0, 9);
    // Level first, then a swap to the next direction round (never straight from profile to behind).
    if (g.tilt === 0) {
      g.u = toward(g.u, 1, 8);
      if (Math.abs(g.u - 1) < 0.05 && t - g.swapAt > 0.13) {
        g.yaw += Math.sign(target.yaw - g.yaw);
        g.u = 1;
        g.swapAt = t;
      }
    }
  } else {
    // A small move of the thing is not followed: the head moves when it is a little way off.
    if (g.tilt === 0 && Math.abs(target.u - g.u) > 0.18) g.u = toward(g.u, Math.min(PITCH_TOP[g.yaw] ?? 1, target.u), 5);
    // Stopped about level in front of it or at you: now and then a tilt of the head, held, then back.
    const level = Math.abs(g.u - 1) < 0.25 && g.yaw < 2;
    const tilting = level && still > 0.9 && still < 3.2 && hash(Math.floor(g.stillAt * 3) + g.yaw) < tilty;
    g.tilt = toward(g.tilt, tilting ? 1 : 0, tilting ? 4 : 6);
  }
  const yaw = Math.max(0, Math.min(2, g.yaw));
  if (g.tilt > 0 && yaw < 2) {
    if (Math.abs(g.u - 1) > 0.02) g.u = toward(g.u, 1, 8);
    return along(TILTS[kind][yaw] as readonly SpriteKey[], g.tilt, 1);
  }
  return along(GAZE_DIRS[kind][yaw] as readonly SpriteKey[], g.u / (PITCH_TOP[yaw] ?? 1), 1);
}
/**
 * Lying down, sitting on an edge or peeking over one, the head turns to the pointer with that pose's
 * own drawings (up, back over the shoulder, down, at you) instead of getting up to watch. Only while
 * the pointer is near and has moved in the last few seconds; otherwise the pose goes on by itself.
 */
const REST_LOOKS = {
  loaf: { base: "loaf", up: link("loaf", "loaf_up", "u"), back: link("loaf", "loaf_back", "v") },
  perch: { base: "perch_fwd", down: link("perch_fwd", "perch_down", "u"), you: link("perch_fwd", "perch_you", "x") },
  peek: { base: "peek", up: link("peek", "peek_up", "v"), back: link("peek", "peek_back") },
} as const;
type RestGroup = keyof typeof REST_LOOKS;
export const REST_GROUPS = new Set<string>(Object.keys(REST_LOOKS));
/** Which of the pose's looks fits the pointer: dx ahead of the head, dy above it (px). null: straight ahead. */
export function restLook(group: RestGroup, dx: number, dy: number): string | null {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (group === "loaf") return dx < -40 ? "back" : deg > 28 && deg < 150 ? "up" : null;
  if (group === "perch") return deg < -25 && deg > -150 ? "down" : dx < -40 || deg > 50 ? "you" : null;
  return dx < -40 ? "back" : deg > 35 ? "up" : null;
}
interface RestGaze { since: number; at: string | null; amt: number; t: number; cx: number; cy: number; movedAt: number }
const restGazes = new Map<string, RestGaze>();
function restShot(slot: string, group: RestGroup, since: number, t: number, dx: number, dy: number, cursor: { x: number; y: number }, near: boolean): Shot | null {
  let r = restGazes.get(slot);
  if (!r || r.since !== since) restGazes.set(slot, (r = { since, at: null, amt: 0, t, cx: cursor.x, cy: cursor.y, movedAt: -99 }));
  const dt = Math.max(0, Math.min(0.1, t - r.t));
  r.t = t;
  if (Math.hypot(cursor.x - r.cx, cursor.y - r.cy) > 3) ((r.movedAt = t), (r.cx = cursor.x), (r.cy = cursor.y));
  const active = near && t - r.movedAt < 5;
  const want = active ? restLook(group, dx, dy) : null;
  // Back to ahead first, then over to the new look (never straight from up to back).
  if (want !== r.at) {
    r.amt = Math.max(0, r.amt - dt / 0.3);
    if (r.amt === 0) r.at = want;
  } else if (r.at) r.amt = Math.min(1, r.amt + dt / 0.35);
  const looks = REST_LOOKS[group] as Record<string, readonly SpriteKey[] | SpriteKey>;
  if (!r.at || r.amt === 0) return active ? still(looks.base as SpriteKey) : null;
  return along(looks[r.at] as readonly SpriteKey[], r.amt, 1);
}
/** A dog cocks its head at a sound or a stopped hand far more than a cat does. */
const TILTY: Record<string, number> = { biscuit: 0.8, chili: 0.75, mochi: 0.5, bandit: 0.45, clover: 0.3, hazel: 0.4 };
/** Looking round with nothing in particular to follow: up, higher, ahead, over to you and back. */
const LOOKING: Seg[] = [
  move(link("sit", "sg_ahead", "g"), 0.25, false, 1), move(gazePath(GAZE_SIT, 2), 0.4, false, 1), hold("sg_up", 1.3), move(GAZE_SIT.slice(6, 10), 0.3, false, 1), hold("sg_high", 1.1),
  move(rev(GAZE_SIT.slice(3, 10)), 0.6, false, 1), hold("sg_ahead", 0.5), ...visit(link("sg_ahead", "sg_you", "u"), 0.35, 1.1, 0.35, 1), hold("sg_ahead", 0.4),
  // Round over the shoulder: three quarters, behind, up behind, and back the same way.
  hold("sq_level", 0.16), hold("sb_level", 1.0), move(chain(["sb_level", "sb_up"]), 0.35, false, 1), hold("sb_up", 0.9),
  move(rev(chain(["sb_level", "sb_up"])), 0.35, false, 1), hold("sb_level", 0.3), hold("sq_level", 0.16), hold("sg_ahead", 0.5),
];
const LOOKING_STAND: Seg[] = [
  move(link("stand", "tg_ahead", "g"), 0.25, false, 1), move(gazePath(GAZE_STAND, 2), 0.4, false, 1), hold("tg_up", 1.3), move(rev(gazePath(GAZE_STAND, 2)), 0.4, false, 1), hold("tg_ahead", 0.6),
  move(gazePath(GAZE_STAND, 0), 0.4, false, 1), hold("tg_down", 1.1), move(rev(gazePath(GAZE_STAND, 0)), 0.4, false, 1), ...visit(link("tg_ahead", "tg_you", "u"), 0.35, 1.0, 0.35, 1),
  hold("tq_level", 0.16), hold("tb_level", 1.1), move(chain(["tb_level", "tb_up"]), 0.35, false, 1), hold("tb_up", 0.8), move(rev(chain(["tb_level", "tb_up"])), 0.35, false, 1),
  hold("tb_level", 0.3), hold("tq_level", 0.16), hold("tg_ahead", 0.5),
];

/** The loaf: blinking, looking up, looking back over the shoulder, getting drowsy. */
const LOAFING: Idle[] = [
  { segs: visit(link("loaf", "loaf_drowse", "w"), 1.0, 5, 0.6), every: 70, seed: 24, p: 0.5 },
  { segs: visit(link("loaf", "loaf_up", "u"), 0.5, 2.4), every: 40, seed: 22, p: 0.5 },
  { segs: visit(link("loaf", "loaf_back", "v"), 0.6, 2.0), every: 55, seed: 23, p: 0.45 },
  { segs: visit(link("loaf", "loaf_blink"), 0.12, 0.08, 0.16, 1), every: 9, seed: 21, p: 0.85 },
];
/** On a ledge: the tail swings slowly under it, and now and then a look down, a doze, a lazy kick or a look at you. */
const PERCH_SWING = chain(["perch_fwd", "perch_back"], 3);
const swinging = (t: number): Shot => along(PERCH_SWING, (1 - Math.cos((t * 2 * Math.PI) / 4.6)) / 2, 1);
const PERCHING: Idle[] = [
  { segs: visit(link("perch_fwd", "perch_doze", "v"), 1.0, 5, 0.5), every: 60, seed: 32, p: 0.5 },
  { segs: visit(link("perch_fwd", "perch_down", "u"), 0.6, 2.4), every: 30, seed: 31, p: 0.6 },
  { segs: visit(link("perch_fwd", "perch_you", "x"), 0.45, 1.8), every: 45, seed: 34, p: 0.5 },
  { segs: [...visit(link("perch_fwd", "perch_kick", "w"), 0.35, 0.2, 0.4), ...visit(link("perch_fwd", "perch_kick", "w"), 0.35, 0.2, 0.45)], every: 25, seed: 33, p: 0.5 },
];
/** Peeking over an edge: a look along it, ducking down, popping up. */
const PEEKING: Idle[] = [
  { segs: visit(link("peek", "peek_duck", "u"), 0.25, 1.2, 0.4), every: 14, seed: 42, p: 0.6 },
  { segs: visit(link("peek", "peek_up", "v"), 0.3, 1.0), every: 11, seed: 43, p: 0.6 },
  { segs: visit(link("peek", "peek_back"), 0.5, 1.5), every: 9, seed: 41, p: 0.7 },
];
/** Lying on the side: a long stretch now and then, and the tail flicking up. */
const SPRAWLING: Idle[] = [
  { segs: visit(link("sprawl", "sprawl_stretch"), 0.8, 1.5, 0.9), every: 35, seed: 51, p: 0.6 },
  { segs: visit(link("sprawl", "roll1", "u"), 0.3, 0.7, 0.45), every: 12, seed: 52, p: 0.6 },
];

/** A hop's height: up fast, a moment at the top, down fast. */
const HOP_UP = 46;
const rise = (h: number) => (u: number): number => h * Math.sin((u * Math.PI) / 2);
const fall = (h: number) => (u: number): number => h * Math.cos((u * Math.PI) / 2);
const HOP: Seg[] = [
  hold("hop_crouch", 0.22), lifted(move(link("hop_crouch", "hop_up"), 0.16), rise(HOP_UP)), lifted(hold("hop_up", 0.1), () => HOP_UP),
  lifted(move(link("hop_up", "hop_land"), 0.16), fall(HOP_UP)), move(link("hop_land", "hop_crouch"), 0.2),
];
/** A twisting leap out of the crouch (a rabbit's binky), landing like a hop. */
const BINKY: Seg[] = [
  hold("hop_crouch", 0.25), lifted(move(link("hop_crouch", "binky", "u"), 0.18), rise(HOP_UP * 1.3)), lifted(hold("binky", 0.16), () => HOP_UP * 1.3),
  lifted(steps(["binky", "hop_land"], 0.18), fall(HOP_UP * 1.3)), move(link("hop_land", "hop_crouch"), 0.22),
];

/** Each animal's own pace for the noisy things: a chihuahua yaps fast, a rabbit squeaks seldom. */
const YAPPY = new Set(["chili"]);

/** Plays `entry` once, then `loop` over and over. */
function looped(entry: readonly Seg[], loop: readonly Seg[], e: number): Shot | null {
  const a = lengthOf(entry);
  if (e < a) return play(entry, e);
  return play(loop, (e - a) % lengthOf(loop));
}

/**
 * The poses that play a little program from the moment they start (`e` seconds ago): a howl rises,
 * holds and falls, a bark opens the mouth first, getting cross starts with a look, a hop for joy
 * goes up and comes down. Null when the pose has none.
 */
export function poseShot(anim: Anim, id: string, e: number): Shot | null {
  const yappy = YAPPY.has(id);
  anim = ownOr(id, anim);
  switch (anim) {
    case "shake_off": {
      // Head to tail, the way a wet dog shakes (Dickerson et al. 2012: about 5 twists a second at
      // this size, faster for a small dog), as cartoon swaps: flow can't follow a whole body
      // twisting. The dog's ends on the drawing from the front, the fur fluffed out; then pleased.
      const front = hasOwn(id, "dshake3");
      const half = 1 / (2 * (front ? 5 : 7));
      const sh = 0.035;
      const twist: Seg[] = [];
      for (let i = 0; i < (front ? 3 : 6); i++) twist.push(hold("dshake1", half, sh), hold("dshake2", half, sh));
      if (front) twist.push(hold("dshake3", half * 0.9, sh), hold("dshake2", half * 0.9, sh), hold("dshake3", half * 0.9, sh), hold("dshake1", half * 0.9, sh * 0.5));
      // The fluffed-up end holds until the shake is over (the executor's step is SHAKE_SEC long).
      const prog = [hold("stand", 0.12), ...twist];
      prog.push(hold("dshake4", Math.max(0.5, SHAKE_SEC - lengthOf(prog))));
      return play(prog, e) ?? still("dshake4");
    }
    case "wag":
      // About three wags a second, tail side to side.
      return looped([], [move(WAG, 0.17, true, 1), move(rev(WAG), 0.17, true, 1)], e);
    case "chew": {
      // Down into a loaf with the toy, between its paws: about two chews a second, a pause, and now
      // and then a look up at you.
      const gnaw = (sec: number): Seg => move(CHEW_LOOP, sec, true, 1);
      return looped([...STOP_TO_LOAF, move(LOAF_CHEW, 0.45), hold("chew1", 0.4)], [
        gnaw(0.5), gnaw(0.46), gnaw(0.52), gnaw(0.48), hold("chew1", 0.6), gnaw(0.5), gnaw(0.47), gnaw(0.53), hold("chew1", 0.35), ...visit(CHEW_UP, 0.35, 1.3, 0.35), hold("chew1", 0.5),
      ], e);
    }
    case "burrow": {
      // Under the blanket: ears up, a peek out, and off to sleep; now and then it peeks out again.
      const peek: Seg[] = [move(rev(DOZE_OFF), 0.7), hold("blanket1", 0.5), ...visit(PEEK_OUT, 0.4, 1.8, 0.45), hold("blanket1", 0.6), move(DOZE_OFF, 0.9)];
      return looped([hold("blanket1", 1.4), ...visit(PEEK_OUT, 0.45, 2.2, 0.45), hold("blanket1", 0.9), move(DOZE_OFF, 1.0)], [hold("blanket3", 16), ...peek], e);
    }
    case "shiver":
      // Trembling, and now and then down onto its seat with a front paw held up off the floor.
      return looped([hold("shiver", 1.8)], [move(SHIVER_PAW, 0.4), hold("pawup", 1.6), move(rev(SHIVER_PAW), 0.4), hold("shiver", 2.4)], e);
    case "paw_up":
      return play([move(PAWUP_SIT, 0.35), hold("pawup_sit", 1.5), move(rev(PAWUP_SIT), 0.35)], e) ?? still("sit");
    case "listen":
      // Stock still with the head down, tilting it to place the sound.
      return looped([hold("listen1", 0.9)], [move(LISTEN, 0.3), hold("listen2", 1.1), move(rev(LISTEN), 0.3), hold("listen1", 0.8)], e);
    case "mouse_out":
      // A little hop back out of the hole.
      return play([lifted(hold("mouse_out", 0.32), (u) => 16 * Math.sin(Math.PI * u))], e) ?? still("mouse_out");
    case "nose_push":
      return looped([hold("nosepush1", 0.2)], [move(NOSEPUSH_LOOP, 0.7, true), hold("nosepush1", 0.2), move(NOSEPUSH_LOOP, 0.62, true)], e);
    case "wash_hands":
      // Both hands rubbing round in the water, about once a second.
      return looped([hold("wash1", 0.3)], [move(WASH_LOOP, 0.95, true, 1), move(WASH_LOOP, 1.02, true, 1), hold("wash1", 0.2)], e);
    case "rummage":
      return looped([hold("rummage1", 0.25)], [move(RUMMAGE_LOOP, 0.55, true), move(RUMMAGE_LOOP, 0.5, true), move(RUMMAGE_LOOP, 0.6, true), hold("rummage1", 0.35)], e);
    case "hold":
      // The find at its chest, up to the mouth for a nibble, and down again.
      return looped([move(HOLD_IN, 0.35), hold("hold1", 0.5)], [move(HOLD_NIBBLE, 0.28), hold("hold2", 0.45), move(rev(HOLD_NIBBLE), 0.25), hold("hold1", 0.55)], e);
    case "thump":
      // Up on alert, then the stamp: the foot hits the ground at 1.0 s and every 1.33 s after
      // (executor THUMP_AT, where the thud is).
      return looped([move(THUMP_UP, 0.35), hold("thump1", 0.58), move(STAMP, 0.07, true, 1)], [hold("thump2", 0.12), move(rev(STAMP), 0.15), hold("thump1", 0.99), move(STAMP, 0.07, true, 1)], e);
    case "flop":
      // Over onto its side all at once, then flat out, eyes shut.
      return play([hold("flop1", 0.35)], e) ?? still("flop2");
    case "nibble":
      return looped([hold("nibble1", 0.2)], [move(NIBBLE_LOOP, 0.42, true, 1), move(NIBBLE_LOOP, 0.4, true, 1), move(NIBBLE_LOOP, 0.44, true, 1), hold("nibble1", 0.3)], e);
    case "nut": {
      // Sitting up, the nut looked at, up to the mouth, gnawed fast (about four a second), turned.
      const gnaw = (sec: number): Seg => move(NUT_LOOP, sec, true, 1);
      return looped([move(NUT_IN, 0.4), hold("nut3", 0.5), move(NUT_UP, 0.3)], [gnaw(0.24), gnaw(0.22), gnaw(0.25), gnaw(0.23), gnaw(0.24), hold("nut1", 0.35)], e);
    }
    case "cheeks":
      return play([move(CHEEKS_IN, 0.35)], e) ?? still("cheeks");
    case "pat":
      return looped([hold("pat1", 0.15)], [move(PAT_LOOP, 0.32, true, 1), move(PAT_LOOP, 0.3, true, 1), move(PAT_LOOP, 0.34, true, 1), hold("pat1", 0.25)], e);
    case "flick":
      // A burst of tail flicks, and still, watching.
      return looped([hold("stand", 0.35)], [hold("flick", 0.14), hold("stand", 0.12), hold("flick", 0.14), hold("stand", 0.12), hold("flick", 0.16), hold("stand", 0.9)], e);
    case "howl":
      if (yappy) {
        // A chihuahua's howl is a string of high yaps.
        return looped([move(link("sit", "howl1", "h"), 0.12, false, 1)], [move(link("howl1", "howl2"), 0.1, false, 1), hold("howl2", 0.16), move(rev(link("howl1", "howl2")), 0.12, false, 1), hold("howl1", 0.18)], e);
      }
      return looped([], [
        move(link("sit", "howl1", "h"), 0.35), move(link("howl1", "howl2"), 0.5), hold("howl2", 1.6), move(link("howl2", "howl3"), 0.5), hold("howl3", 0.4), move(link("howl3", "sit"), 0.4), hold("sit", 0.8),
      ], e);
    case "bark":
      return looped([move(link("sit", "bark1", "k"), 0.15, false, 1)], [
        move(link("bark1", "bark2"), 0.08, true, 1), hold("bark2", yappy ? 0.1 : 0.14), move(link("bark2", "bark1"), 0.1, true, 1), hold("bark1", yappy ? 0.14 : 0.32),
      ], e);
    case "giggle":
      return looped([], [move(link("giggle1", "giggle2"), 0.25), hold("giggle2", 0.2), move(link("giggle2", "giggle1"), 0.25), hold("giggle1", 0.2)], e);
    case "chatter":
      // Eyes on something up high, the jaw going fast.
      return looped([move(link("sit", "sg_ahead", "g"), 0.2, false, 1), move(GAZE_SIT.slice(3, 10), 0.4, false, 1)], [
        move(link("sg_high", "chatter1", "c"), 0.08, true, 1), move(rev(link("sg_high", "chatter1", "c")), 0.08, true, 1),
      ], e);
    case "angry":
      return looped([move(link("stand", "cross", "x"), 0.3), hold("cross", 0.5), move(link("cross", "angry1"), 0.35)], [
        move(link("angry1", "angry2"), 0.4), hold("angry2", 0.25), move(link("angry2", "angry1"), 0.4), hold("angry1", 0.25),
      ], e);
    case "hiss":
      return looped([move(link("stand", "cross", "x"), 0.2), move(link("cross", "hiss1", "u"), 0.25), move(link("hiss1", "hiss2"), 0.2)], [
        hold("hiss2", 0.9), move(link("hiss2", "hiss1"), 0.25), hold("hiss1", 0.35), move(link("hiss1", "hiss2"), 0.2),
      ], e);
    case "puffed":
      return looped([hold("puff1", 0.3)], [move(link("puff1", "puff2"), 0.35), hold("puff2", 0.3), move(link("puff2", "puff1"), 0.35), hold("puff1", 0.3)], e);
    case "startled":
      // A jump back off the ground, then frozen on the spot, a paw up.
      return play([lifted(hold("jumpback", 0.38), (u) => 36 * Math.sin(Math.PI * u))], e) ?? still("tg_freeze");
    case "annoyed":
      return looped([hold("annoyed", 0.9)], [hold("annoyed1", 1.4), move(link("annoyed1", "annoyed2"), 0.12, true), hold("annoyed2", 0.25), move(link("annoyed2", "annoyed1"), 0.35)], e);
    case "flustered":
      return looped([], [hold("flustered", 1.0), ...visit(link("flustered", "fluster1"), 0.4, 1.6)], e);
    case "shy":
      return looped([], [hold("shy", 1.2), ...visit(link("shy", "shy1"), 0.35, 0.9, 0.3)], e);
    case "beg":
      return looped([hold("beg", 0.3), move(link("beg", "beg1"), 0.3)], [move(link("beg1", "beg2"), 0.3), hold("beg2", 0.4), move(link("beg2", "beg1"), 0.3), hold("beg1", 0.6)], e);
    case "headbutt":
      return looped([hold("rub", 0.3)], [hold("headbutt1", 0.4), move(link("headbutt1", "headbutt2"), 0.4), hold("headbutt2", 0.5), move(link("headbutt2", "headbutt1"), 0.4)], e);
    case "proud":
      return looped([], [hold("proud", 1.2), ...visit(link("proud", "proud2"), 0.4, 1.5)], e);
    case "curious":
      return looped([], [hold("curious", 1.8), hold("sg_ahead", 0.3), ...visit(link("sg_ahead", "sg_ear", "v"), 0.12, 0.35, 0.15, 1), hold("sg_ahead", 0.3)], e);
    case "look":
      return looped([], LOOKING, e);
    case "lick_lips":
      return looped([], LIP_LICK, e);
    case "pee":
      // Down into the squat (a dog lifts its leg), then the relieved look comes and goes.
      return looped([move(PEE_IN, 0.7), hold("pee1", 0.5)], [move(chain(["pee1", "pee2"], 3), 0.6), hold("pee2", 1.5), move(chain(["pee2", "pee1"], 3), 0.6), hold("pee1", 0.6)], e);
    case "poop":
      // Hunched down, staring into the distance, straining now and then.
      return looped([move(POOP_IN, 0.8), hold("poop1", 0.9)], [move(chain(["poop1", "poop2"], 3), 0.45), hold("poop2", 1.1), move(chain(["poop2", "poop1"], 3), 0.45), hold("poop1", 1.3)], e);
    case "cover": {
      // Three or four rakes (a dog: kicks), then a pause to check, and again.
      const rake = [move(chain(["cover1", "cover2"], 3), 0.2, true), move(chain(["cover2", "cover1"], 3), 0.2, true)];
      return looped([move(COVER_IN, 0.45)], [...rake, ...rake, ...rake, hold("cover1", 0.55)], e);
    }
    case "paw_shake": {
      const flick = [hold("pawshake", 0.07), hold("pawshakez1", 0.07)];
      return play([move(SHAKE_IN, 0.3), ...flick, ...flick, ...flick, ...flick, hold("pawshake", 0.15), move(SHAKE_OUT, 0.3)], e) ?? still("stand");
    }
    case "belly":
      return looped([move(link("belly", "belly_l"), 0.4)], [move(link("belly_l", "belly_r"), 0.45), hold("belly_r", 0.35), move(link("belly_r", "belly_l"), 0.45), hold("belly_l", 0.35)], e);
    case "play_bow":
      return looped([hold("bow_down", 0.15), move(link("bow_down", "bow_l"), 0.3)], [hold("bow_l", 0.9), move(link("bow_l", "bow_up"), 0.22), hold("bow_up", 0.15), move(rev(link("bow_l", "bow_up")), 0.25)], e);
    case "happy": {
      // Hops for joy, and every third one (every other for a rabbit) a twisting leap.
      const n = id === "clover" ? 2 : 3;
      const round: Seg[] = [...Array.from({ length: n - 1 }, () => HOP).flat(), ...BINKY];
      return looped([], round, e);
    }
    case "eat": {
      // Nose down at the food, chewing: the head bobs, three or four chews, a short pause, again.
      const chew = (sec: number): Seg => move(nodOf("sniff2"), sec, true, 1);
      return looped([hold("sniff2", 0.25)], [chew(0.3), chew(0.28), chew(0.33), hold("sniff2", 0.4), chew(0.3), chew(0.32), chew(0.27), chew(0.34), hold("sniff2", 0.65)], e);
    }
    case "sniff":
      return looped([], [hold("sniff1", 0.5), move(link("sniff1", "sniff2"), 0.35), hold("sniff2", 0.6), move(link("sniff2", "sniff3"), 0.4), hold("sniff3", 0.8), move(link("sniff3", "sniff1"), 0.45)], e);
    case "dig": {
      // Quick scrapes with one front paw and the other, then a look at the hole.
      const scrape = [move(link("dig1", "dig2"), 0.11, true, 1), move(link("dig2", "dig1"), 0.11, true, 1)];
      return looped([], [...Array.from({ length: 5 }, () => scrape).flat(), move(link("dig1", "dig2"), 0.11, true, 1), move(link("dig2", "dig3", "u"), 0.25), hold("dig3", 0.7), move(link("dig3", "dig1"), 0.3)], e);
    }
    case "pounce":
      // Crouched low, the bottom wiggling before the spring.
      return looped([hold("stalk1", 0.45)], [move(link("stalk1", "stalk2"), 0.14, true, 1), move(link("stalk2", "stalk1"), 0.14, true, 1)], e);
    case "watch":
      return looped([], LOOKING, e);
    case "watch_stand":
      return looped([], LOOKING_STAND, e);
    default:
      return null;
  }
}

/**
 * Mid-poop, your cursor comes close: it looks round at you, sheepish (blushing), holds that while you
 * stay, and goes back to its business. One per drawing slot.
 */
const blushes = new Map<string, { at: number; out: number | null }>();
const BLUSH_SEC = 0.35;
function blushShot(slot: string, near: boolean, t: number, ready: boolean): Shot | null {
  let b = blushes.get(slot);
  if (!b && near && ready) blushes.set(slot, (b = { at: t, out: null }));
  if (!b) return null;
  if (b.out === null && !near && t - b.at > BLUSH_SEC + 1.2) b.out = t;
  if (b.out !== null) {
    const u = (t - b.out) / BLUSH_SEC;
    if (u >= 1) {
      blushes.delete(slot);
      return null;
    }
    return along(SHEEPISH_OUT, smooth(u));
  }
  const u = (t - b.at) / BLUSH_SEC;
  return u < 1 ? along(SHEEPISH_IN, smooth(u)) : still("sheepish");
}

/** Turning round on the spot, standing or sitting, `u` (0 to 1) of the way: slow to start and to stop. */
export function turnShot(kind: "stand" | "sit", u: number): Shot {
  const steps = TURN_STEPS[kind];
  const x = smooth(Math.max(0, Math.min(1, u))) * (steps.length - 1);
  return still(steps[Math.min(steps.length - 1, Math.round(x))] as SpriteKey);
}

/** Sitting down after a walk, standing up, lying down, settling into a loaf, waking, stretching, sneezing. */
// Stopping from a walk: the walk frames are the standing drawing, so the rear goes down out of it.
const FROM_STAND: Seg[] = [move(link("stand", "sitting_down", "d"), 0.22), hold("sitting_down", 0.08), move(link("sitting_down", "sit2"), 0.25)];
const SIT_DOWN: Seg[] = [...FROM_STAND, hold("sit2", 0.08), move(link("sit2", "sit"), 0.22)];
const STAND_UP: Seg[] = [move(link("sit", "stand2", "v"), 0.18), move(link("stand2", "stand"), 0.14)];
const LIE_DOWN: Seg[] = [
  hold("sit2", 0.15), move(link("sit2", "lowering", "l"), 0.35), hold("lowering", 0.25), move(link("lowering", "loaf2"), 0.35), hold("loaf2", 0.25),
  move(link("loaf2", "drowsy"), 0.4), hold("drowsy", 0.5), move(link("drowsy", "curl"), 0.4), hold("curl", 0.3), move(link("curl", "sleep"), 0.4),
];
const STOP_TO_SLEEP: Seg[] = [...FROM_STAND, ...LIE_DOWN];
const WAKE: Seg[] = [hold("waking", 0.45), move(link("waking", "wake"), 0.3), hold("wake", 0.35)];
const WAKE_TO_SIT: Seg[] = [...WAKE, move(link("wake", "sit"), 0.35)];
const LOAF_IN: Seg[] = [move(link("sit2", "lowering", "l"), 0.35), hold("lowering", 0.2), move(link("lowering", "loaf2"), 0.3), hold("loaf2", 0.15), move(link("loaf2", "loaf", "f"), 0.3)];
const STOP_TO_LOAF: Seg[] = [...FROM_STAND, ...LOAF_IN];
/** Up out of the loaf (LOAF_IN the other way) to the half sit, and the dog's up from chewing (ADR-067). */
const UP_FROM_LOAF: Seg[] = [move(rev(link("loaf2", "loaf", "f")), 0.25), hold("loaf2", 0.06), move(rev(link("lowering", "loaf2")), 0.28), move(rev(link("sit2", "lowering", "l")), 0.3)];
const CHEW_TO_SIT: Seg[] = [move(rev(LOAF_CHEW), 0.3), ...UP_FROM_LOAF, move(link("sit2", "sit"), 0.2)];
const CHEW_TO_STAND: Seg[] = [move(rev(LOAF_CHEW), 0.3), ...UP_FROM_LOAF, move(rev(link("sitting_down", "sit2")), 0.22), move(rev(link("stand", "sitting_down", "d")), 0.2)];
/** Own moves that stand: from a sit they stand up first, and a sit after them sits down first. */
const STANDING_OWN = new Set(["wag", "flick"]);
const STRETCH_IN: Seg[] = [hold("stretch1", 0.3), move(link("stretch1", "stretch2"), 0.3), hold("stretch2", 0.3), move(link("stretch2", "stretch3"), 0.35), hold("stretch3", 1.45), move(link("stretch3", "shake"), 0.25)];
const LOOK_ROUND: Seg[] = [move(["stand", "pottyback"], 0.14, false, 1), hold("pottyback", 0.55), move(["pottyback", "stand"], 0.14, false, 1)];
const LOOK_BACK_PEE: Seg[] = [move(PEE_UP, 0.45), ...LOOK_ROUND];
const LOOK_BACK_POOP: Seg[] = [move(POOP_UP, 0.45), ...LOOK_ROUND];
const SNEEZE_IN: Seg[] = [hold("presneeze", 0.55), move(link("presneeze", "sneeze2"), 0.12), hold("sneeze2", 0.3), move(link("sneeze2", "dazed"), 0.25)];

/**
 * Frames that play once when a pose starts: stretching, sneezing, settling down to sleep, waking up,
 * lying down, sitting down after a walk, standing up. `prev` is the kind of pose before, `e` seconds
 * since this one began.
 */
function sequenceShot(anim: Anim, plan: SpritePlan, prev: string, e: number): Shot | null {
  const wasMoving = MOVING.has(prev);
  // Up from lying flat: back over through the flop first.
  if (prev === "flop" && plan.group !== "flop") {
    const up = play([hold("flop1", 0.22)], e);
    if (up) return up;
  }
  if (plan.group === "stretch") return play(STRETCH_IN, e) ?? still("shake");
  if (anim === "sneeze") return play(SNEEZE_IN, e) ?? still("dazed");
  // Up out of the squat, a look back at what it did, and standing.
  if (anim === "potty_look") return play(prev === "poop" ? LOOK_BACK_POOP : LOOK_BACK_PEE, e) ?? still("stand");
  if (plan.group === "sleep" && prev !== "sleep" && prev !== "") return play(wasMoving ? STOP_TO_SLEEP : LIE_DOWN, e);
  if (prev === "sleep" && plan.group !== "sleep" && plan.group !== "dangle") return play(plan.group === "sit" ? WAKE_TO_SIT : WAKE, e);
  if (plan.group === "loaf" && prev !== "loaf" && prev !== "sleep" && prev !== "") return play(wasMoving ? STOP_TO_LOAF : LOAF_IN, e);
  if (SITTING.has(plan.group) && wasMoving) return play(SIT_DOWN, e);
  // Standing up first: the gait frames are made from "stand", so the walk grows out of it.
  if (MOVING.has(plan.group) && SITTING.has(prev)) return play(STAND_UP, e);
  return null;
}
/**
 * Frames that lead into a pose from the one before (ADR-067), so a whole-body change plays as a move
 * and not a cross-fade: up from chewing, standing up for a wag and sitting down after it, the
 * shivering chihuahua down onto its seat with a paw up and up again. `prevKey` is the drawing shown
 * when the pose changed. The pose's own program starts after these.
 */
function leadIn(group: string, prev: string, prevKey: SpriteKey): Seg[] | null {
  if (prev === "chew" && group !== "chew" && !MOVING.has(group)) return SITTING.has(group) ? CHEW_TO_SIT : CHEW_TO_STAND;
  if (prev === "shiver" && group === "paw_up") return [...(prevKey === "shiver" || prevKey === "shiverx1" ? [move(SHIVER_PAW, 0.4)] : []), hold("pawup", 60)];
  if (prev === "paw_up" && SITTING.has(group) && (prevKey === "pawup" || prevKey === "shiverx2")) return [move(PAWUP_DOWN, 0.4)];
  if (STANDING_OWN.has(group) && SITTING.has(prev)) return STAND_UP;
  if (SITTING.has(group) && STANDING_OWN.has(prev)) return SIT_DOWN;
  return null;
}
const MOVING = new Set(["walk", "trot", "run"]);
/** Poses that sit: after a walk the animal sits down first, and before a walk it stands up. */
const SITTING = new Set(["sit", "look", "watch", "chatter", "howl", "bark", "giggle", "annoyed", "flustered", "shy", "beg", "proud", "curious", "lick_lips"]);
const SIT_DOWN_SEC = lengthOf(SIT_DOWN);

export interface SpriteDraw {
  sx: number;
  sy: number;
  bob: number;
  /** Vertical speed in pixels a second, positive going down. */
  vy: number;
  /** Forces the position in a walking cycle (for the filmstrip page). */
  phase?: number;
  /** Which drawing of this set it is, when a page draws one character several times. */
  slot?: string;
  /** Where the cursor is, in the same coordinates as x and y: watching follows it with the head. */
  cursor?: { x: number; y: number };
}

/** How each sprite set moved last: where, how fast, how far through its gait, which way it faces and any turn. */
interface Gait {
  x: number | null;
  t: number;
  phase: number;
  /** Ground speed in pixels a second, smoothed. */
  speed: number;
  trot: boolean;
  dir: number;
  /** A turn round in progress: when it began, which way it faced before, standing or sitting. */
  turn: { at: number; from: number; kind: "stand" | "sit" } | null;
  /** When the last turn began and ended: a pose that began with it waits for it to finish. */
  turnAt: number;
  turnEnd: number;
}
const gaits = new Map<string, Gait>();

/** What each sprite set showed last, so a new pose can cross-fade in instead of cutting. */
interface Shown {
  key: SpriteKey;
  next: SpriteKey | null;
  mix: number;
  /** The way the shown frame faced. */
  dir: number;
  group: string;
  since: number;
  prev: string;
  /** The drawing shown when the pose changed. */
  prevKey: SpriteKey;
  from: SpriteKey | null;
  fromDir: number;
  fadeAt: number;
  fade: number;
}
const shown = new Map<string, Shown>();

/** Steps a second where a walker breaks into a trot, and where it drops back to a walk. */
const TROT_ABOVE = 2.9;
const WALK_BELOW = 2.5;

/**
 * Which drawn turn fits: standing (on its feet, walking on or stopping to sit) or sitting (sitting
 * before and after). Anything else (a jump, a hiss) turns by fading the old frame out facing the old way.
 */
function turnKind(key: SpriteKey, was: string, now: string): "stand" | "sit" | null {
  // Covering it up, a cat turns round to face the spot first (from standing, after the look back).
  const settled = now === "walk" || now === "trot" || now === "run" || now === "sit" || now === "cover";
  if (!settled) return null;
  if (GAITISH.test(key) || key.startsWith("turn_s")) return "stand";
  if (was === "sit") return "sit";
  return null;
}

/** A frame of the set. Every key is loaded before a set is handed out (see load), so it is never missing. */
/**
 * The image of a frame. A frame that did not load is drawn as the drawing it was made from (an
 * in-between `<drawing><tag><n>` as that drawing), else as the standing or sitting drawing, so a
 * missing file never makes the animal vanish.
 */
function frameOf(set: SpriteSet, key: SpriteKey): HTMLImageElement {
  return set.img[frameKey(set, key)] as HTMLImageElement;
}

/** The frame whose image frameOf draws for a key. */
function frameKey(set: SpriteSet, key: SpriteKey): SpriteKey {
  const img = set.img[key];
  if (img && img.naturalWidth > 0) return key;
  const from = /^(.+)[a-z]\d$/.exec(key)?.[1] as SpriteKey | undefined;
  const near = from ? set.img[from] : undefined;
  if (from && near && near.naturalWidth > 0) return from;
  return /^(g[wtr]\d|t[gqb]_|turn_s|stand|walk|run|trot)/.test(key) ? "stand" : "sit";
}

/**
 * How much to scale a frame so the animal is the same size in every drawing (ADR-056). The sheets
 * were drawn at different sizes, so a head could be a fifth bigger in one pose than in the next. heads.ts has the measured fix per drawing; an in-between takes it from the two
 * drawings it sits between, and a rigged gait frame from the standing drawing it was made from.
 */
const fixes = new Map<string, number>();
/** `?nofix=1` draws the frames as they are, to compare (characters.html, the playground). */
const NO_FIX = typeof location !== "undefined" && new URLSearchParams(location.search).has("nofix");
export function sizeFix(id: string, key: string): number {
  if (NO_FIX) return 1;
  const at = `${id}/${key}`;
  let v = fixes.get(at);
  if (v === undefined) fixes.set(at, (v = fixFor(id, key, 0)));
  return v;
}
function fixFor(id: string, key: string, depth: number): number {
  const row = HEADS[id];
  if (!row) return 1;
  const own = row[key];
  if (own) return own[0] ?? 1;
  if (depth > 3) return 1;
  const b = BETWEEN.get(key);
  if (b) return fixFor(id, b[0], depth + 1) * (1 - b[2]) + fixFor(id, b[1], depth + 1) * b[2];
  if (/^g[wtr]\d/.test(key)) return fixFor(id, "stand", depth + 1);
  return 1;
}

/**
 * Where a toy held in the teeth sits in a frame, in its own pixels before the size fix (x from the
 * middle, forward; y up from the bottom), or null where the head was not found well enough.
 */
export function mouthOf(id: string, key: string, depth = 0): { x: number; y: number } | null {
  const own = HEADS[id]?.[key];
  if (own) return own[1] !== null && own[2] !== null ? { x: own[1], y: own[2] } : null;
  if (depth > 3) return null;
  const b = BETWEEN.get(key);
  if (b) {
    const a = mouthOf(id, b[0], depth + 1);
    const c = mouthOf(id, b[1], depth + 1);
    if (a && c) return { x: a.x + (c.x - a.x) * b[2], y: a.y + (c.y - a.y) * b[2] };
    return b[2] < 0.5 ? a : c;
  }
  return null;
}

/**
 * Where the paws hold something (a nut, a find) in the drawings that hold one (ADR-067), in the same
 * units as mouthOf. Measured by eye on the drawings (tools/measure-hands.py prints a check sheet).
 */
const HANDS: Record<string, Partial<Record<SpriteKey, [number, number]>>> = {
  hazel: { nut1: [101, 134], nut2: [93, 127], nut3: [81, 101] },
  bandit: { hold1: [45, 130], hold2: [38, 150] },
};
export function handsOf(id: string, key: string, depth = 0): { x: number; y: number } | null {
  const own = HANDS[id]?.[key as SpriteKey];
  if (own) return { x: own[0], y: own[1] };
  if (depth > 3) return null;
  const b = BETWEEN.get(key);
  if (!b) return null;
  const a = handsOf(id, b[0], depth + 1);
  const c = handsOf(id, b[1], depth + 1);
  if (a && c) return { x: a.x + (c.x - a.x) * b[2], y: a.y + (c.y - a.y) * b[2] };
  return a ?? c;
}

/**
 * How far a frame's paws (or its seat, on a ledge) are above its bottom edge, in its own pixels before
 * the size fix. The bottom edge is the lowest pixel, and in many drawings that is the tail: curled round
 * in front of a sitting cat it is drawn a little lower than the paws, and off a ledge it hangs far
 * lower. Measured per drawing by tools/measure-ground.py (ground.ts); an in-between takes it from the
 * two drawings it sits between, a rigged gait frame from the standing drawing.
 */
const grounds = new Map<string, number>();
/** `?noground=1` puts every frame down on its bottom edge, as before, to compare. */
const NO_GROUND = typeof location !== "undefined" && new URLSearchParams(location.search).has("noground");
export function groundOf(id: string, key: string): number {
  if (NO_GROUND) return 0;
  const at = `${id}/${key}`;
  let v = grounds.get(at);
  if (v === undefined) grounds.set(at, (v = groundFor(id, key, 0)));
  return v;
}
function groundFor(id: string, key: string, depth: number): number {
  const row = GROUND[id];
  if (!row) return 0;
  const b = depth <= 3 ? BETWEEN.get(key) : undefined;
  if (b) return groundFor(id, b[0], depth + 1) * (1 - b[2]) + groundFor(id, b[1], depth + 1) * b[2];
  if (/^g[wtr]\d/.test(key)) return groundFor(id, "stand", depth + 1);
  // A lick nod (nodOf, which adds itself to BETWEEN only when first played) keeps its drawing's ground.
  const nod = /^(.+)n[1-5]$/.exec(key);
  if (nod && !(key in row) && depth <= 3) return groundFor(id, nod[1] as string, depth + 1);
  return row[key] ?? 0;
}

/**
 * A frame's drawn width and height in cat units, with the size fix, and how far below the ground its
 * bottom edge goes (`lift`, cat units: the paws are on the ground, the tail lower).
 */
function drawnSize(set: SpriteSet, key: SpriteKey): { w: number; h: number; fix: number; lift: number; img: HTMLImageElement } {
  const k = frameKey(set, key);
  const img = set.img[k] as HTMLImageElement;
  const fix = sizeFix(set.id, k);
  return { w: img.naturalWidth * K * fix, h: img.naturalHeight * K * fix, fix, lift: groundOf(set.id, k) * K * fix, img };
}

const strideOf = (set: SpriteSet, g: "walk" | "trot" | "run"): number => GAIT_STRIDE[set.id]?.[g] ?? 90;

/**
 * The sprites are drawn about twice as big as most screens show them. A canvas only smooths
 * between neighbouring pixels, so shrinking a lot in one go looks jagged. Halving step by step
 * (and keeping the result) gives a clean picture.
 */
const halved = new Map<HTMLImageElement, Map<number, HTMLCanvasElement>>();
function scaledFor(img: HTMLImageElement, targetPx: number): CanvasImageSource {
  const levels = Math.max(0, Math.floor(Math.log2(img.naturalWidth / Math.max(1, targetPx))));
  if (levels === 0 || typeof document === "undefined") return img;
  let byLevel = halved.get(img);
  if (!byLevel) halved.set(img, (byLevel = new Map()));
  const have = byLevel.get(levels);
  if (have) return have;
  let src: CanvasImageSource = img;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  let out = img as unknown as HTMLCanvasElement;
  for (let i = 0; i < levels; i++) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d") as CanvasRenderingContext2D;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(src, 0, 0, w, h);
    src = c;
    out = c;
  }
  byLevel.set(levels, out);
  return out;
}

const blendCanvas = new WeakMap<SpriteSet, HTMLCanvasElement>();

/** One frame of a mix, how much of it, and whether it faces the other way. */
interface Layer {
  img: HTMLImageElement;
  w: number;
  flip: boolean;
  /** The size fix of its frame (ADR-056). */
  fix: number;
  /** How far its bottom edge goes below the ground, in cat units (a tail lower than the paws). */
  lift: number;
}

/**
 * Frames mixed by weight, each with its paws on one ground line and centred like a single frame. They
 * are added in premultiplied colour ("lighter"), so where all are solid the result is solid too: a
 * cross-fade with no see-through moment in the middle. A flipped layer is mirrored round the middle.
 * `top` is how far the ground line is below the top of the result.
 */
function blend(set: SpriteSet, layers: readonly Layer[], ppu: number): { src: CanvasImageSource; w: number; h: number; top: number } {
  const w = Math.max(...layers.map((l) => l.img.naturalWidth * K * l.fix));
  const top = Math.max(...layers.map((l) => l.img.naturalHeight * K * l.fix - l.lift));
  const h = top + Math.max(...layers.map((l) => l.lift));
  let c = blendCanvas.get(set);
  if (!c) blendCanvas.set(set, (c = document.createElement("canvas")));
  const cw = Math.max(1, Math.ceil(w * ppu));
  const ch = Math.max(1, Math.ceil(h * ppu));
  if (c.width !== cw || c.height !== ch) {
    c.width = cw;
    c.height = ch;
  }
  const cx = c.getContext("2d") as CanvasRenderingContext2D;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.globalCompositeOperation = "source-over";
  cx.globalAlpha = 1;
  cx.clearRect(0, 0, cw, ch);
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  layers.forEach((l, i) => {
    const lw = l.img.naturalWidth * K * l.fix;
    const lh = l.img.naturalHeight * K * l.fix;
    cx.setTransform(l.flip ? -1 : 1, 0, 0, 1, l.flip ? cw : 0, 0);
    cx.globalCompositeOperation = i === 0 ? "source-over" : "lighter";
    cx.globalAlpha = l.w;
    cx.drawImage(scaledFor(l.img, lw * ppu), ((w - lw) / 2) * ppu, (top - lh + l.lift) * ppu, lw * ppu, lh * ppu);
  });
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.globalCompositeOperation = "source-over";
  cx.globalAlpha = 1;
  return { src: c, w, h, top };
}

/** Draws the sprite with its feet at body.x, body.y. Returns the head position in cat units. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  set: SpriteSet,
  facing: number,
  anim: Anim,
  x: number,
  y: number,
  scale: number,
  t: number,
  d: SpriteDraw,
): { x: number; y: number; mouth: { x: number; y: number } | null } {
  anim = ownOr(set.id, anim);
  const slot = `${set.id}/${d.slot ?? ""}`;
  let g = gaits.get(slot);
  if (!g) gaits.set(slot, (g = { x: null, t, phase: 0, speed: 0, trot: false, dir: facing, turn: null, turnAt: -1e9, turnEnd: -1e9 }));
  const moving = anim === "walk" || anim === "run" || anim === "keyboard";
  const dx = g.x === null ? 0 : Math.abs(x - g.x);
  const dt = t - g.t;
  if (dt > 0 && dx < 60) g.speed += (dx / dt - g.speed) * Math.min(1, dt * 6);
  // One sprite pixel is K * scale screen pixels. A walker that would step too fast breaks into a trot.
  const px = K * scale;
  if (anim === "walk") {
    const hz = g.speed / (strideOf(set, "walk") * px);
    if (!g.trot && hz > TROT_ABOVE) g.trot = true;
    else if (g.trot && hz < WALK_BELOW) g.trot = false;
  }
  const which = anim === "run" ? "run" : anim === "walk" && g.trot ? "trot" : "walk";
  if (d.phase !== undefined) g.phase = d.phase;
  else if (moving && dx > 0 && dx < 60) {
    // The cycle advances by the distance walked over the stride the gait was made with, so a planted
    // foot stays put on the ground. The keyboard walk is a tiptoe: shorter steps.
    g.phase = (g.phase + dx / (strideOf(set, which) * px * (anim === "keyboard" ? 0.7 : 1))) % 1;
  }
  g.x = x;
  g.t = t;
  const plan = planFor(anim, t, d.vy, g.phase, which === "trot", set.id);
  const m = plan.motion;
  const dir = plan.flip ? -facing : facing;

  let sh = shown.get(slot);
  // A new drawing starts the pose now (with no pose before it, so no one-off sequence replays).
  if (!sh) shown.set(slot, (sh = { key: plan.key, next: null, mix: 0, dir, group: plan.group, since: t, prev: "", prevKey: plan.key, from: null, fromDir: dir, fadeAt: -1e9, fade: 0 }));
  const was = sh.group;
  if (sh.group !== plan.group) {
    sh.prev = sh.group;
    sh.prevKey = sh.key;
    sh.group = plan.group;
    sh.since = t;
  }

  // Turning round: the drawn turn (through three quarters and the front view), the same length as
  // the executor's stop to turn. Where no turn is drawn, the old frame fades out facing the old way.
  let flipFade = false;
  if (dir !== g.dir) {
    const kind = g.turn ? null : turnKind(sh.key, was, plan.group);
    if (kind) {
      g.turn = { at: t, from: g.dir, kind };
      g.turnAt = t;
      g.turnEnd = t + TURN_SEC;
    } else {
      if (g.turn) g.turnEnd = t;
      g.turn = null;
      flipFade = true;
    }
    g.dir = dir;
  }
  if (g.turn && t >= g.turn.at + TURN_SEC) {
    // The last frame of a turn is the first drawing mirrored: go on as that drawing, facing the new way.
    sh.key = g.turn.kind === "stand" ? "stand" : "sit";
    sh.next = null;
    sh.mix = 0;
    sh.dir = g.dir;
    g.turn = null;
  }
  const drawDir = g.turn ? g.turn.from : g.dir;
  // A pose that began with a turn starts its own frames when the turn is over.
  const poseAt = sh.since >= g.turnAt - 0.05 && sh.since < g.turnEnd ? g.turnEnd : sh.since;
  const e = t - poseAt;

  let shot: Shot;
  if (g.turn) shot = turnShot(g.turn.kind, (t - g.turn.at) / TURN_SEC);
  else if (plan.group === "groom") shot = groomShot(set.id, e, hash(poseAt * 0.731 + 1));
  else if (plan.group === "scratch") shot = scratchShot(e, hash(poseAt * 0.731 + 2));
  else if (plan.group === "push" || plan.group === "swat") shot = pawShot(plan.group, e);
  else {
    // A sitting pose after a walk sits down first, and its own program starts after that.
    const lead = leadIn(plan.group, sh.prev, sh.prevKey);
    const settle = lead ? lengthOf(lead) : SITTING.has(plan.group) && MOVING.has(sh.prev) ? SIT_DOWN_SEC : 0;
    let follow: Shot | null = null;
    if ((anim === "watch" || anim === "watch_stand") && d.cursor) {
      // Where the head is, from the looking-ahead drawing, and which way the cursor is from it.
      const look = drawnSize(set, plan.key);
      const hx = x + drawDir * plan.head.x * look.w * scale;
      const hy = y - (plan.head.y * look.h - look.lift) * scale;
      follow = gazeShot(slot, anim === "watch_stand", poseAt, t, gazeTarget((d.cursor.x - hx) * drawDir, hy - d.cursor.y), TILTY[set.id] ?? 0.35);
    } else if (REST_GROUPS.has(plan.group) && d.cursor) {
      const look = drawnSize(set, plan.key);
      const hx = x + drawDir * plan.head.x * look.w * scale;
      const hy = y - (plan.head.y * look.h - look.lift) * scale;
      const dx = (d.cursor.x - hx) * drawDir;
      const dy = hy - d.cursor.y;
      follow = restShot(slot, plan.group as RestGroup, poseAt, t, dx, dy, d.cursor, Math.hypot(dx, dy) < 420 * scale);
    }
    if (anim !== "poop") blushes.delete(slot);
    else if (d.cursor) {
      const look = drawnSize(set, plan.key);
      const hx = x + drawDir * plan.head.x * look.w * scale;
      const hy = y - (plan.head.y * look.h - look.lift) * scale;
      follow = blushShot(slot, Math.hypot(d.cursor.x - hx, d.cursor.y - hy) < 180 * scale, t, e > 1.8);
    }
    shot = sequenceShot(anim, plan, sh.prev, e) ?? (lead ? play(lead, e) : null) ?? follow ?? poseShot(anim, set.id, e - settle) ?? { key: plan.key, next: plan.next ?? null, mix: plan.mix ?? 0 };
  }

  // A new frame cross-fades in, except where it is the neighbour the last one was gliding to (or
  // from), or the next frame of a gait or a spin.
  const fadeFrom = (sec: number): void => {
    const s = sh as Shown;
    s.from = s.next && s.mix >= 0.5 ? s.next : s.key;
    s.fromDir = s.dir;
    s.fadeAt = t;
    s.fade = sec;
  };
  if (flipFade) fadeFrom(0.22);
  else if (shot.key !== sh.key) {
    const glided = shot.key === sh.next || shot.next === sh.key || sameTurn(shot.key, sh.key);
    const loop = loopOf.get(shot.key);
    if (!glided && (loop === undefined || loop !== loopOf.get(sh.key))) {
      // Out of a walk (or into one) is quick: a moving animal changes pose fast, and two different
      // bodies overlapping for long look like a double exposure.
      const gaitSide = GAITISH.test(shot.key) || GAITISH.test(sh.key);
      // A head turning from one direction to another is quick: a slow fade shows two heads.
      const headTurn = GAZE_KEY.test(shot.key) && GAZE_KEY.test(sh.key);
      // A pose that swaps faster than that (a shake) keeps its own quicker blend, out of a stand too.
      fadeFrom(shot.key === "blink" || sh.key === "blink" ? 0.06 : headTurn ? 0.08 : gaitSide ? Math.min(0.12, plan.fade ?? 0.12) : g.turn ? 0.1 : (plan.fade ?? 0.24));
    }
  }
  sh.key = shot.key;
  sh.next = shot.next;
  sh.mix = shot.mix;
  sh.dir = drawDir;
  const k = sh.from !== null && t - sh.fadeAt < sh.fade ? smooth(Math.max(0, (t - sh.fadeAt) / sh.fade)) : 1;
  if (k >= 1) sh.from = null;
  const { w, h, lift } = drawnSize(set, shot.key);

  // Breathing, steps, rocking and the occasional fidget. A fast tremble or a quick hop of more than a
  // few pixels reads as flicker on the real screen (frames come from a timer and are not perfectly
  // even), so the faster a motion is, the smaller it is kept.
  const breathAmp = m.breathHz > 6 ? Math.min(m.breath, 0.02) : m.breath;
  const wobbleAmp = m.wobbleHz > 20 ? Math.min(m.wobble, 0.007) : m.wobbleHz > 10 ? Math.min(m.wobble, 0.015) : m.wobble;
  const bounceAmp = m.stepHz > 4 ? Math.min(m.bounce, 0.7) : m.bounce;
  const breath = Math.sin(t * m.breathHz) * breathAmp;
  // A hop on the clock for bouncy poses. The gaits bob in their own frames.
  let hop = !moving && m.stepHz ? Math.abs(Math.sin(Math.PI * t * m.stepHz)) * bounceAmp : 0;
  // A program off the ground (a hop for joy, a jump back), in sprite pixels.
  hop += (shot.lift ?? 0) * K;
  let rot = (plan.rot ?? 0) + m.lean + (m.wobbleHz ? Math.sin(t * m.wobbleHz) * wobbleAmp : 0) + (shot.shake ? Math.sin(t * 44) * shot.shake : 0);
  // About every half minute, at uneven times, it shifts its weight a little.
  const shift = m.fidget ? eventAt(t, 18, 0.9, 9, 0.6) : null;
  if (shift) {
    const ph = shift.into / 0.9;
    rot += Math.sin(ph * Math.PI * 2) * 0.025 * (1 - ph);
    hop += Math.sin(ph * Math.PI) * 0.8;
  }
  const sx = d.sx * (1 - breath * 0.5);
  const sy = d.sy * (1 + breath);

  const deviceScale = ctx.getTransform();
  const ppu = scale * Math.hypot(deviceScale.a, deviceScale.b);
  ctx.save();
  ctx.translate(x, y + (d.bob - hop) * scale);
  ctx.rotate(rot * drawDir);
  ctx.scale(scale * drawDir * sx, scale * sy);
  if (plan.spin) {
    ctx.translate(0, -h / 2);
    ctx.rotate(Math.sin(t * 9) * 0.35);
    ctx.translate(0, h / 2);
  }
  if (plan.roll) {
    // Over and over around the middle, with the feet still the pivot of the placement.
    ctx.translate(0, -h / 2);
    ctx.rotate(t * 13);
    ctx.translate(0, h / 2);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const layers: Layer[] = [];
  const layer = (key: SpriteKey, wt: number, flip: boolean): Layer => {
    const f = drawnSize(set, key);
    return { img: f.img, w: wt, flip, fix: f.fix, lift: f.lift };
  };
  if (k < 1 && sh.from !== null) layers.push(layer(sh.from, 1 - k, sh.fromDir !== drawDir));
  const mix = shot.next ? shot.mix : 0;
  if (mix < 0.999) layers.push(layer(shot.key, k * (1 - mix), false));
  if (shot.next && mix > 0.001) layers.push(layer(shot.next, k * mix, false));
  // Where the mouth is in the frame that shows most (measured, heads.ts), in the caller's coordinates,
  // so a toy carried in the teeth is drawn there and not at a guess (ADR-056).
  let mouth: { x: number; y: number } | null = null;
  const weighed: [SpriteKey, number][] = [[shot.key, k * (1 - mix)]];
  if (shot.next) weighed.push([shot.next, k * mix]);
  if (k < 1 && sh.from !== null && sh.fromDir === drawDir) weighed.push([sh.from, 1 - k]);
  weighed.sort((a, b) => b[1] - a[1]);
  for (const [key] of weighed) {
    const fk = frameKey(set, key);
    // Something held in the paws (a nut, a find) goes to the paws, not the mouth.
    const mo = handsOf(set.id, fk) ?? mouthOf(set.id, fk);
    if (!mo) continue;
    if (typeof DOMPoint === "undefined") break;
    const f = sizeFix(set.id, fk);
    const at = deviceScale.inverse().multiply(ctx.getTransform()).transformPoint(new DOMPoint(mo.x * K * f, -(mo.y - groundOf(set.id, fk)) * K * f));
    mouth = { x: at.x, y: at.y };
    break;
  }
  if (layers.length === 1 && !(layers[0] as Layer).flip) {
    const only = layers[0] as Layer;
    const ow = only.img.naturalWidth * K * only.fix;
    const oh = only.img.naturalHeight * K * only.fix;
    ctx.drawImage(scaledFor(only.img, ow * ppu), -ow / 2, -oh + only.lift, ow, oh);
  } else {
    const b = blend(set, layers, ppu);
    ctx.drawImage(b.src, -b.w / 2, -b.top, b.w, b.h);
  }
  ctx.restore();
  // The head, upright and in the direction the cat is facing, for hearts and other effects.
  return { x: plan.head.x * w, y: -(plan.head.y * h - lift), mouth };
}

/** The width of the current sprite in cat units (for the soft shadow). */
export function spriteWidth(set: SpriteSet, anim: Anim, t: number): number {
  const key = planFor(anim, t, 0, 0, false, set.id).key;
  // Gait frames have room around the drawing for the legs, so the shadow goes by the standing pose.
  return drawnSize(set, /^g[wtr]\d/.test(key) ? "stand" : key).w;
}
