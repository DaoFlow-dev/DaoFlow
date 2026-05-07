import { fireEvent, screen } from "@testing-library/react";

export function clickSelectOption(name: string | RegExp) {
  const option = screen.getByRole("option", { name });

  fireEvent.mouseMove(option);
  fireEvent.click(option);
}
