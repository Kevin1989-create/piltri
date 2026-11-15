import type { Metadata } from "next";

// The page itself is a client component, which can't carry metadata.
export const metadata: Metadata = {
  title: "Find your Piltri: eight silly questions, your places",
  description: "Eight silly questions - different every time - and the places in the world that fit you best.",
};

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return children;
}
