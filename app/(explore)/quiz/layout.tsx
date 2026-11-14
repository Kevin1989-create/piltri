import type { Metadata } from "next";

// The page itself is a client component, which can't carry metadata.
export const metadata: Metadata = {
  title: "Find your Piltri: a few questions, the places that fit you",
  description: "Answer a few questions - what you're looking for, the weather you love, what you want nearby - and see the places in the world that fit you best.",
};

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return children;
}
