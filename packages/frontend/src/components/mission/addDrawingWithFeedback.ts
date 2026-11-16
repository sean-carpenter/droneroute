import { toast } from "sonner";
import { addDrawingFromFile, DrawingFileError } from "@/lib/drawingImport";

/**
 * Add a drawing from a file, telling the user how it went. Shared by the
 * sidebar button and dropping a PDF on the editor.
 */
export async function addDrawingWithFeedback(file: File): Promise<boolean> {
  const id = toast.loading(`Reading ${file.name}…`);
  try {
    await addDrawingFromFile(file);
    toast.success("Drawing added", {
      id,
      description:
        "Press Adjust next to it in the Site section to move, resize or spin it until it lines up with the map. It stays out of the way of the other tools the rest of the time.",
    });
    return true;
  } catch (err) {
    if (!(err instanceof DrawingFileError)) console.error(err);
    toast.error(
      err instanceof DrawingFileError
        ? err.message
        : `${file.name} could not be added as a drawing`,
      { id },
    );
    return false;
  }
}
