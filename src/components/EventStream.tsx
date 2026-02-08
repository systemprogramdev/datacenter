"use client";

// SSE EventStream is disabled during development to prevent dev server overload.
// It will be re-enabled for production when the scheduler is actively generating events.
// The dashboard still updates via polling intervals.

export default function EventStream() {
  return null;
}
