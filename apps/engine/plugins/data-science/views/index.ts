import notebook from "./notebook.html" with { type: "text" };
import table from "./table.html" with { type: "text" };
import views from "./views.css" with { type: "text" };

const text = (source: unknown) => source as string;

export const DATA_SCIENCE_VIEWS: Readonly<Record<string, string>> = {
  "notebook.html": text(notebook),
  "table.html": text(table),
  "views.css": text(views),
};
