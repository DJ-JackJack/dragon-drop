/** The world-map tools, their keys and what they do. One list: the toolbar, the key handler and the shortcut sheet all read it. */
import type { Tool } from "./MapView.tsx";

export type ToolDef = { id: Tool; label: string; key: string; tip: string };

export const TOOL_GROUPS: { name: string; tools: ToolDef[] }[] = [
  { name: "Move", tools: [
    { id: "pan", label: "Pan", key: "H", tip: "Drag to move the map (or hold Space / right-drag with any tool)" },
    { id: "select", label: "Select", key: "V", tip: "Click a place, label or region to edit it; drag to move it; Delete removes it. Click bare ground to point Claude at that spot" },
    { id: "area", label: "Select area", key: "E", tip: "Drag a rectangle, circle or freehand shape to show Claude exactly where you mean. Click for a single point. Esc clears" },
    { id: "measure", label: "Ruler", key: "K", tip: "Click points along a route to measure it: miles and km, the ground along the way and how long it takes on foot, riding, by wagon or by ship. Double-click or Enter finishes, Backspace takes back a point, Esc clears" },
  ] },
  { name: "Terrain", tools: [
    { id: "raise", label: "Raise", key: "R", tip: "Paint terrain upward" },
    { id: "lower", label: "Lower", key: "L", tip: "Paint terrain downward" },
    { id: "smooth", label: "Smooth", key: "S", tip: "Soften bumps and sharp edges. Raise Reach to soften a wide straight step in the land" },
    { id: "flatten", label: "Flatten", key: "F", tip: "Level terrain to the height where the stroke starts" },
    { id: "land", label: "Land", key: "A", tip: "Push the coastline out: paint new low land into the sea" },
    { id: "water", label: "Water", key: "W", tip: "Pull the coastline in: paint sea over land" },
  ] },
  { name: "Names and areas", tools: [
    { id: "place", label: "Place", key: "P", tip: "Click to add a named place (city, fort, ruin...)" },
    { id: "label", label: "Label", key: "T", tip: "Click to add a label (sea, region, range...), or drag to draw a line for it to follow" },
    { id: "line", label: "Roads", key: "O", tip: "Draw a road, trail or border. Roads and trails are routed over the terrain for you" },
    { id: "river", label: "Rivers", key: "I", tip: "Drag to draw a river's course, or click to start one at a spot. Name and select: point at a river or lake to see it whole, click to name it (or select it, if it has a name)" },
    { id: "realm", label: "Realm", key: "B", tip: "Paint kingdoms, provinces and other realms onto the land, each in its own colour; their borders follow from the paint" },
    { id: "region", label: "Climate", key: "C", tip: "Climate region: click its corners, then double-click (or click the first corner, or press Enter) to close it. Esc cancels" },
    { id: "detail", label: "Detail map", key: "D", tip: "Drag a box around an area to make a separate, more detailed map of it" },
    { id: "battlehere", label: "Battlemap here", key: "M", tip: "Click a spot to make a battlemap of the ground there (its climate, rivers, lakes and coast choose the floors)" },
    { id: "cityhere", label: "Settlement here", key: "Y", tip: "Click a place or a spot to start a settlement map there: a village, a town or a city (its climate, height, slope, coast and river come from the world map)" },
  ] },
];
