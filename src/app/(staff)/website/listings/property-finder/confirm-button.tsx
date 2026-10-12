"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

/** A submit button that asks first: taking a listing over changes the website at once. */
export function ConfirmSubmitButton({
  message,
  ...props
}: React.ComponentProps<typeof Button> & { message: string }) {
  return (
    <Button
      type="submit"
      {...props}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    />
  );
}
