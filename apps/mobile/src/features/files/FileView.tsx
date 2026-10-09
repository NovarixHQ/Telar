import { Button, Divider, HStack, Text as SwiftText } from "@expo/ui/swift-ui";
import { buttonStyle, disabled, font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { EmptyState, Theme } from "../../ui";
import { AddressRow, CopyPathItems, ProblemBanner, ReferenceItem } from "./address-row";
import { CodeView, TextEditor } from "./CodeView";
import { ImageFileView, PdfFileView } from "./MediaViews";
import { refusalCopy, type SaveState } from "./save";
import { fileKind, humanBytes } from "./tree";
import { useTextFile } from "./use-text-file";

type Props = {
  host: HostConnection;
  sessionId: string;
  path: string;
  root?: string | undefined;
  onReference?: ((path: string) => void) | undefined;
  onSaveState: (state: SaveState | undefined) => void;
};

/** One checkout file in the viewer its kind calls for: code to read and edit, prose that saves itself, a picture or a PDF. */
export function FileView(props: Props) {
  const kind = fileKind(props.path);
  if (kind === "image") return <ImageFileView host={props.host} sessionId={props.sessionId} path={props.path} />;
  if (kind === "pdf") return <PdfFileView host={props.host} sessionId={props.sessionId} path={props.path} />;
  return <TextFileView {...props} prose={kind === "prose"} />;
}

function TextFileView({ host, sessionId, path, root, onReference, onSaveState, prose }: Props & { prose: boolean }) {
  const edit = useTextFile(host, sessionId, path, prose, onSaveState);
  const { file } = edit;
  const canEdit = !!file && !file.binary && !file.truncated;

  const tools =
    prose || file?.binary !== false ? null : (
      <HStack spacing={14}>
        {edit.dirty ? <SwiftText modifiers={[font({ textStyle: "caption", weight: "medium" }), foregroundStyle(Theme.amber)]}>Unsaved</SwiftText> : null}
        {canEdit && edit.editing ? (
          <Button onPress={() => void edit.save()} modifiers={[buttonStyle("plain"), disabled(!edit.dirty || edit.saving)]}>
            <SwiftText modifiers={[font({ textStyle: "caption", weight: "medium" }), foregroundStyle(edit.dirty && !edit.saving ? Theme.accent : Theme.textMuted)]}>Save</SwiftText>
          </Button>
        ) : canEdit ? (
          <Button onPress={() => edit.setEditing(true)} modifiers={[buttonStyle("plain")]}>
            <SwiftText modifiers={[font({ textStyle: "caption", weight: "medium" }), foregroundStyle(Theme.text)]}>Edit</SwiftText>
          </Button>
        ) : null}
      </HStack>
    );
  const menu = (
    <>
      <CopyPathItems path={path} root={root} />
      <Divider />
      <Button label="Re-read from disk" systemImage="arrow.clockwise" onPress={edit.reread} />
      <ReferenceItem path={path} onReference={onReference} />
    </>
  );

  return (
    <View style={styles.fill}>
      <AddressRow path={path} detail={file ? humanBytes(file.bytes) : undefined} trailing={tools} menu={menu} />
      {edit.refusal ? (
        <ProblemBanner message={refusalCopy(edit.refusal)} onReread={edit.refusal === "conflict" ? edit.reread : undefined} />
      ) : edit.failure ? (
        <ProblemBanner message={edit.failure} />
      ) : null}
      {file?.binary ? (
        <EmptyState icon="doc.zipper" title="Binary file" detail={`${humanBytes(file.bytes)} of bytes rather than text, so nothing was sent to read.`} />
      ) : file && prose ? (
        <TextEditor text={edit.text} onChange={edit.edit} kind={path.toLowerCase().endsWith(".md") ? "markdown" : "prose"} />
      ) : file ? (
        <View style={styles.fill}>
          {file.truncated ? <Text style={styles.truncated}>{`Truncated: the first ${humanBytes(file.text.length)} of ${humanBytes(file.bytes)}, so it can't be edited here.`}</Text> : null}
          {canEdit && edit.editing ? <TextEditor text={edit.text} onChange={edit.edit} kind="code" autoFocus /> : <CodeView path={path} text={edit.text} />}
        </View>
      ) : edit.error ? (
        <EmptyState icon="xmark.circle" title="Could not read this file" detail={edit.error} />
      ) : (
        <ActivityIndicator style={styles.fill} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  truncated: { fontSize: 12, color: Theme.amber, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: Theme.codeBackground },
});
