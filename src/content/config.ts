import { defineCollection, z } from "astro:content";
import { file } from "astro/loaders";

const ideas = defineCollection({
  loader: file("src/content/ideas.yaml"),
  schema: z.object({
    title: z.string(),
    region: z.enum(["sf", "bay_area"]),
    subregion: z.enum([
      "westside",
      "eastside",
      "middle",
      "north",
      "north_bay",
      "east_bay",
      "peninsula_south",
    ]),
    access: z
      .array(z.enum(["car", "ferry", "bart", "caltrain", "smart", "bus"]))
      .default([]),
    tags: z.array(z.string()).default([]),
    notes: z.string().optional(),
  }),
});

export const collections = { ideas };
