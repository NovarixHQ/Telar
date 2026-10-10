import data from "./data.html" with { type: "text" };
import notebook from "./notebook.html" with { type: "text" };
import table from "./table.html" with { type: "text" };
import views from "./views.css" with { type: "text" };

const text = (source: unknown) => source as string;

export const DATA_SCIENCE_VIEWS: Readonly<Record<string, string>> = {
  "data.html": text(data),
  "notebook.html": text(notebook),
  "table.html": text(table),
  "views.css": text(views),
};
