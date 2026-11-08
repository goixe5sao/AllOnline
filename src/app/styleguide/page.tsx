import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

export default function StyleguidePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Gallery />;
}
