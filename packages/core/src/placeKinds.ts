/**
 * Every kind of place a marker can stand for: the one list the editor's picker, the map's markers, the label sizes, the name-placement order and Claude's
 * `add_place` tool all read. The first nine are the original abstract map symbols (circles for settlements, a square for a fort...); the rest are small
 * pictures (see placeIcons.ts). A kind says what a place IS, never anything about the setting: no names, no lore.
 *
 * To add one: add it here, give it a picture in placeIcons.ts (a test fails until you do) and, if it is a new group, list the group in PLACE_GROUPS.
 */
export const PLACE_GROUPS = ["Settlements", "Strongholds", "Faith and magic", "Wild places", "Travel and trade", "Land", "Work", "Events and dangers", "General"] as const;
export type PlaceGroup = (typeof PLACE_GROUPS)[number];

export interface PlaceKindInfo {
  id: string;
  name: string;
  group: PlaceGroup;
  /** Size of the name beside the marker, in map px for a 1024-px-wide map. */
  label: number;
  /** Which names are placed first when the map is crowded (lower first). */
  rank: number;
  /** A one-line description (for the picker's tooltip and for Claude). */
  hint: string;
  /** Drawn as a small picture (placeIcons.ts) rather than one of the original symbols. */
  picture: boolean;
}

// (generic, so each id stays its own literal type and PlaceType is a real union)
const k = <I extends string>(id: I, name: string, group: PlaceGroup, label: number, rank: number, picture: boolean, hint: string) => ({ id, name, group, label, rank, picture, hint });

export const PLACE_KINDS = [
  // settlements
  k("capital", "Capital", "Settlements", 11, 0, false, "The chief city of a realm"),
  k("city", "City", "Settlements", 10, 1, false, "A large settlement"),
  k("town", "Town", "Settlements", 9, 3, false, "A market town"),
  k("village", "Village", "Settlements", 8, 5, false, "A small settlement"),
  k("hamlet", "Hamlet", "Settlements", 8, 6, true, "A few houses"),
  k("farm", "Farm", "Settlements", 8, 7, true, "A farmstead"),
  // strongholds
  k("fort", "Fort", "Strongholds", 9, 4, false, "A fortified post"),
  k("castle", "Castle", "Strongholds", 9, 4, true, "A castle or keep"),
  k("tower", "Tower", "Strongholds", 8, 6, true, "A lone tower: watchtower, wizard's tower"),
  k("battlefield", "Battlefield", "Strongholds", 8, 7, true, "Where a battle was fought"),
  // faith and magic
  k("temple", "Temple", "Faith and magic", 8, 5, true, "A temple or church"),
  k("shrine", "Shrine", "Faith and magic", 8, 7, true, "A small holy place"),
  k("graveyard", "Graveyard", "Faith and magic", 8, 7, true, "A graveyard or tomb"),
  k("portal", "Portal", "Faith and magic", 8, 7, true, "A gate between places or worlds"),
  k("standing_stones", "Standing stones", "Faith and magic", 8, 7, true, "A circle or row of ancient stones"),
  // wild places
  k("cave", "Cave", "Wild places", 8, 7, true, "A cave mouth"),
  k("dungeon", "Dungeon", "Wild places", 8, 7, true, "A way down into a dungeon or undercroft"),
  k("mine", "Mine", "Wild places", 8, 7, true, "A mine or quarry"),
  k("ruin", "Ruin", "Wild places", 8, 6, false, "Ruins of a building or a settlement"),
  k("lair", "Lair", "Wild places", 8, 7, true, "A beast's den or lair"),
  k("camp", "Camp", "Wild places", 8, 7, true, "A camp: travellers, bandits, an army"),
  // travel and trade
  k("port", "Port", "Travel and trade", 9, 2, false, "A harbour"),
  k("lighthouse", "Lighthouse", "Travel and trade", 8, 6, true, "A lighthouse"),
  k("bridge", "Bridge", "Travel and trade", 8, 7, true, "A bridge"),
  k("inn", "Inn", "Travel and trade", 8, 7, true, "An inn or tavern on the road"),
  k("crossroads", "Crossroads", "Travel and trade", 8, 7, true, "Where roads meet"),
  // land
  k("peak", "Peak", "Land", 8, 7, true, "A notable mountain"),
  k("volcano", "Volcano", "Land", 8, 7, true, "A volcano"),
  k("waterfall", "Waterfall", "Land", 8, 7, true, "A waterfall"),
  k("grove", "Grove", "Land", 8, 7, true, "A notable tree or grove"),
  k("oasis", "Oasis", "Land", 8, 7, true, "Water and shade in dry country"),
  k("mill", "Mill", "Work", 8, 7, true, "A mill"),
  // events and dangers
  k("shipwreck", "Shipwreck", "Events and dangers", 8, 7, true, "A wreck"),
  k("treasure", "Treasure", "Events and dangers", 8, 7, true, "A hoard or a buried chest"),
  k("danger", "Danger", "Events and dangers", 8, 7, true, "A hazard: monsters, a curse, a trap"),
  k("mystery", "Mystery", "Events and dangers", 8, 7, true, "Something unexplained or unexplored"),
  // general
  k("landmark", "Landmark", "General", 8, 7, false, "Any landmark"),
  k("other", "Other", "General", 8, 8, false, "Anything else"),
] as const;

/** The id of every kind: what a place's `type` can be. */
export type PlaceType = (typeof PLACE_KINDS)[number]["id"];

export const PLACE_TYPE_IDS = PLACE_KINDS.map((x) => x.id) as unknown as [PlaceType, ...PlaceType[]];

const BY_ID = new Map<string, PlaceKindInfo>(PLACE_KINDS.map((x) => [x.id, x]));
/** The details of a kind (an unknown id, from a file made by a newer version, reads as "other"). */
export function placeKind(id: string): PlaceKindInfo {
  return BY_ID.get(id) ?? (BY_ID.get("other") as PlaceKindInfo);
}
export const isPlaceType = (id: string): id is PlaceType => BY_ID.has(id);
