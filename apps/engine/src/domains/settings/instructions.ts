export function personInstructions(global: string | undefined, project: string | undefined): string | undefined {
  const parts = [
    ...(global?.trim() ? [global.trim()] : []),
    ...(project?.trim() ? [`For this project:\n${project.trim()}`] : []),
  ];
  return parts.length ? `The person you work for left these instructions for every agent:\n\n${parts.join("\n\n")}` : undefined;
}
