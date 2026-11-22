import { z } from "zod";

export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(isRealDate, {
    message: "must be a real calendar date and clock time",
  });
export type IsoDate = z.infer<typeof IsoDate>;

function isRealDate(value: string) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}
