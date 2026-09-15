// FolderExplorer.jsx
// A real folder browser. Folders here are actual directories on disk —
// creating one makes a real Directory, and "adding a file" copies its
// bytes straight into that directory. There's no separate metadata layer
// to keep in sync: what you see is what's on disk, and it's exactly what
// server.js serves to other devices over the LAN.
//
// Requires:
//   expo-document-picker   (or @react-native-documents/picker on bare RN)
//   expo-file-system
//
// Usage:
//   <FolderProvider>
//     <FolderExplorer />
//   </FolderProvider>

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DisplayFolderQR from "../../DisplayFolderQR";
import {
  ACCESSIBILITY,
  getAllAccessibility,
  setFolderAccessibility,
} from "./AccessibilityStore";
import { useFolders } from "./FolderStore";
import { getFolderPasscode } from "./Passcodestore";

// -------------------------------------------------------------------------
// Small helpers
// -------------------------------------------------------------------------

const EXT_ICON = {
  png: "🖼️",
  jpg: "🖼️",
  jpeg: "🖼️",
  gif: "🖼️",
  webp: "🖼️",
  mp4: "🎞️",
  mov: "🎞️",
  webm: "🎞️",
  mp3: "🎵",
  wav: "🎵",
  ogg: "🎵",
  pdf: "📕",
  zip: "🗜️",
};

function iconForFile(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return EXT_ICON[ext] || "📄";
}

function formatBytes(size) {
  if (size === undefined || size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// Who to credit as the author of anything this device creates. Same idea
// as the guest name typed into folderView.html for LAN uploads, just
// persisted locally instead of passed as a URL param.
const DISPLAY_NAME_KEY = "digispot:displayName";

// -------------------------------------------------------------------------
// Main component
// -------------------------------------------------------------------------

export default function FolderExplorer() {
  const {
    listDir,
    createFolder,
    deleteEntry,
    renameEntry,
    importFiles,
    setPasscode,
    removePasscode,
    hasPasscode,
    getAuthor,
  } = useFolders();

  const [currentPath, setCurrentPath] = useState([]); // array of segment names
  const [newFolderModalVisible, setNewFolderModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState(null); // { name, isDir }
  const [renameValue, setRenameValue] = useState("");
  const [passcodeTarget, setPasscodeTarget] = useState(null); // folder name
  const [passcodeValue, setPasscodeValue] = useState("");
  const [folderActionsTarget, setFolderActionsTarget] = useState(null); // folder object
  const [qrTarget, setQrTarget] = useState(null); // { name, passcode }
  const [accessibilityTarget, setAccessibilityTarget] = useState(null); // folder object
  const [accessibility, setAccessibility] = useState({}); // cache of accessibility states

  // Display name credited as the author of anything created on this
  // device. Loaded once from AsyncStorage; "Host" until the person sets one.
  const [displayName, setDisplayName] = useState("");
  const [displayNameModalVisible, setDisplayNameModalVisible] = useState(false);
  const [displayNameValue, setDisplayNameValue] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(DISPLAY_NAME_KEY).then((v) => {
      if (v) setDisplayName(v);
    });
  }, []);

  // Load accessibility settings on mount and after changes
  useEffect(() => {
    getAllAccessibility().then(setAccessibility);
  }, []);

  const effectiveAuthor = displayName.trim() || "Host";

  // Re-derive the listing on every render — listDir already reflects the
  // latest state.version bump from the store, so this stays cheap and
  // always correct without a separate effect/cache to maintain.
  const { folders, files } = useMemo(
    () => listDir(currentPath),
    [listDir, currentPath],
  );

  // -------------------- actions --------------------

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolder(currentPath, newFolderName, effectiveAuthor);
    setNewFolderName("");
    setNewFolderModalVisible(false);
  };

  const handleSaveDisplayName = async () => {
    const clean = displayNameValue.trim();
    setDisplayName(clean);
    await AsyncStorage.setItem(DISPLAY_NAME_KEY, clean);
    setDisplayNameModalVisible(false);
  };

  const handleImportFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        // The picker's own file:// copy reads reliably later too, unlike a
        // raw content:// URI whose Android read permission isn't
        // guaranteed to survive past this picking session.
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const assets = "assets" in result ? result.assets : [result];

      const picked = assets
        .filter((a) => a && a.uri)
        .map((a) => ({ uri: a.uri, name: a.name || "Untitled file" }));

      const results = importFiles(currentPath, picked, effectiveAuthor);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        Alert.alert(
          "Some files failed to import",
          failed.map((f) => `${f.name}: ${String(f.error)}`).join("\n"),
        );
      }
    } catch (err) {
      Alert.alert("Import failed", String(err));
    }
  };

  const handleOpenFile = async (file) => {
    try {
      // contentUri is expo-file-system's FileProvider-backed URI, needed
      // to hand this file's bytes to another app to open.
      const openUri = new File(file.uri).contentUri || file.uri;
      const supported = await Linking.canOpenURL(openUri);
      if (!supported) {
        Alert.alert(
          "Cannot open file",
          "No app is registered to open this type of file.",
        );
        return;
      }
      await Linking.openURL(openUri);
    } catch (err) {
      Alert.alert("Could not open file", String(err));
    }
  };

  const promptRename = (name, isDir) => {
    // Alert.prompt is iOS-only; for cross-platform use a modal + TextInput.
    setRenameTarget({ name, isDir });
    setRenameValue(name);
  };

  // Android's Alert.alert silently drops any button past the 3rd, so this
  // menu uses a custom modal instead — see <FolderActionsModal /> below.
  const handleFolderLongPress = (folder) => {
    setFolderActionsTarget(folder);
  };

  // Handle accessibility toggle for a folder
  const handleAccessibilityToggle = async (folder, folderSegments) => {
    const current =
      accessibility[[...folderSegments].join("/")] ?? ACCESSIBILITY.PUBLIC;
    let newMode;

    // Cycle: PUBLIC → PROTECTED → PRIVATE → PUBLIC
    if (current === ACCESSIBILITY.PUBLIC) {
      newMode = ACCESSIBILITY.PROTECTED;
    } else if (current === ACCESSIBILITY.PROTECTED) {
      newMode = ACCESSIBILITY.PRIVATE;
    } else {
      newMode = ACCESSIBILITY.PUBLIC;
    }

    await setFolderAccessibility(folderSegments, newMode);
    setAccessibility((prev) => ({
      ...prev,
      [[...folderSegments].join("/")]: newMode,
    }));

    // Show confirmation message
    const messages = {
      [ACCESSIBILITY.PUBLIC]: "Folder is now public — anyone can access it.",
      [ACCESSIBILITY.PROTECTED]:
        "Folder is now protected — guests need a passcode to access it.",
      [ACCESSIBILITY.PRIVATE]:
        "Folder is now private — completely inaccessible to guests.",
    };

    Alert.alert(`"${folder.name}" accessibility changed`, messages[newMode]);
  };

  const getFolderActions = (folder) => {
    const folderSegments = [...currentPath, folder.name];
    const locked = hasPasscode(folderSegments);
    const currentAccessibility =
      accessibility[[...folderSegments].join("/")] ?? ACCESSIBILITY.PUBLIC;

    return [
      {
        text: "Toggle Accessibility",
        onPress: () => handleAccessibilityToggle(folder, folderSegments),
      },
      {
        text: "Show QR",
        onPress: async () => {
          const code = await getFolderPasscode(folderSegments);
          if (!code) {
            Alert.alert(
              "No passcode set",
              `Set a passcode for "${folder.name}" first — the QR code encodes it so guests can scan their way in.`,
            );
            return;
          }
          setQrTarget({ name: folder.name, passcode: code });
        },
      },
      {
        text: "Open",
        onPress: () => setCurrentPath([...currentPath, folder.name]),
      },
      { text: "Rename", onPress: () => promptRename(folder.name, true) },
      {
        text: locked ? "Change passcode" : "Set passcode",
        onPress: () => {
          setPasscodeTarget(folder.name);
          setPasscodeValue("");
        },
      },
      ...(locked
        ? [
            {
              text: "View passcode",
              onPress: async () => {
                const code = await getFolderPasscode(folderSegments);
                Alert.alert(
                  `Passcode for "${folder.name}"`,
                  code ?? "No passcode set.",
                );
              },
            },
            {
              text: "Remove passcode",
              destructive: true,
              onPress: () => removePasscode(folderSegments),
            },
          ]
        : []),
      {
        text: "Delete",
        destructive: true,
        onPress: () =>
          Alert.alert(
            `Delete "${folder.name}"?`,
            "This deletes the folder and everything inside it from your device.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => deleteEntry(currentPath, folder.name, true),
              },
            ],
          ),
      },
    ];
  };

  const handleFileLongPress = (file) => {
    Alert.alert(file.name, undefined, [
      { text: "Open", onPress: () => handleOpenFile(file) },
      { text: "Rename", onPress: () => promptRename(file.name, false) },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          Alert.alert(
            `Delete "${file.name}"?`,
            "This removes the file from your device.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => deleteEntry(currentPath, file.name, false),
              },
            ],
          ),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // Get appropriate icon based on accessibility state
  const getAccessibilityIcon = (folderSegments) => {
    const mode =
      accessibility[[...folderSegments].join("/")] ?? ACCESSIBILITY.PUBLIC;
    switch (mode) {
      case ACCESSIBILITY.PRIVATE:
        return "🚫"; // Private/inaccessible
      case ACCESSIBILITY.PROTECTED:
        return "🔒"; // Protected with passcode
      case ACCESSIBILITY.PUBLIC:
      default:
        return "📁"; // Public
    }
  };

  // -------------------- render --------------------

  return (
    <View style={styles.container}>
      <Breadcrumbs path={currentPath} onNavigate={setCurrentPath} />

      <TouchableOpacity
        style={styles.displayNamePill}
        onPress={() => {
          setDisplayNameValue(displayName);
          setDisplayNameModalVisible(true);
        }}
      >
        <Text style={styles.displayNamePillText}>
          👤 You're creating things as "{effectiveAuthor}"
        </Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {folders.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Folders</Text>
            <View style={styles.folderGrid}>
              {folders.map((folder) => (
                <TouchableOpacity
                  key={folder.name}
                  style={styles.folderCard}
                  onPress={() => setCurrentPath([...currentPath, folder.name])}
                  onLongPress={() => handleFolderLongPress(folder)}
                  delayLongPress={500}
                  activeOpacity={0.7}
                >
                  <Text style={styles.folderIcon}>
                    {getAccessibilityIcon([...currentPath, folder.name])}
                  </Text>
                  <Text style={styles.folderName} numberOfLines={1}>
                    {folder.name}
                  </Text>
                  {folder.author && (
                    <Text style={styles.authorSub} numberOfLines={1}>
                      by {folder.author}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {files.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Files</Text>
            <FlatList
              data={files}
              keyExtractor={(f) => f.name}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.fileRow}
                  onPress={() => handleOpenFile(item)}
                  onLongPress={() => handleFileLongPress(item)}
                >
                  <Text style={styles.fileIcon}>{iconForFile(item.name)}</Text>
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.fileSub} numberOfLines={1}>
                      {[
                        formatBytes(item.size),
                        item.author && `by ${item.author}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </>
        )}

        {folders.length === 0 && files.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🗂️</Text>
            <Text style={styles.emptyText}>No folders or files yet</Text>
            <Text style={styles.emptySubtext}>
              Create a folder or add files to get started
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonSecondary]}
          onPress={() => setDisplayNameModalVisible(true)}
        >
          <Text style={styles.actionButtonTextSecondary}>Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setNewFolderModalVisible(true)}
        >
          <Text style={styles.actionButtonText}>+ Folder</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleImportFiles}
        >
          <Text style={styles.actionButtonText}>+ Files</Text>
        </TouchableOpacity>
      </View>

      <SimpleInputModal
        visible={newFolderModalVisible}
        title="Create a folder"
        placeholder="Folder name"
        value={newFolderName}
        onChangeText={setNewFolderName}
        onSubmit={handleCreateFolder}
        submitLabel="Create"
        onClose={() => {
          setNewFolderModalVisible(false);
          setNewFolderName("");
        }}
      />

      <SimpleInputModal
        visible={!!renameTarget}
        title={`Rename ${renameTarget?.isDir ? "folder" : "file"}`}
        placeholder="New name"
        value={renameValue}
        onChangeText={setRenameValue}
        onSubmit={() => {
          if (renameValue.trim() && renameValue !== renameTarget.name) {
            renameEntry(
              currentPath,
              renameTarget.name,
              renameValue,
              renameTarget.isDir,
            );
          }
          setRenameTarget(null);
          setRenameValue("");
        }}
        submitLabel="Rename"
        onClose={() => {
          setRenameTarget(null);
          setRenameValue("");
        }}
      />

      <SimpleInputModal
        visible={!!passcodeTarget}
        title={`${
          hasPasscode([...currentPath, passcodeTarget]) ? "Change" : "Set"
        } passcode for "${passcodeTarget}"`}
        placeholder="Enter passcode (leave blank to remove)"
        value={passcodeValue}
        onChangeText={setPasscodeValue}
        onSubmit={() => {
          setPasscode([...currentPath, passcodeTarget], passcodeValue);
          setPasscodeTarget(null);
          setPasscodeValue("");
        }}
        submitLabel="Save"
        onClose={() => {
          setPasscodeTarget(null);
          setPasscodeValue("");
        }}
      />

      <FolderActionsModal
        visible={!!folderActionsTarget}
        title={folderActionsTarget?.name || ""}
        actions={
          folderActionsTarget ? getFolderActions(folderActionsTarget) : []
        }
        onClose={() => setFolderActionsTarget(null)}
      />

      <FolderQRModal
        visible={!!qrTarget}
        folderName={qrTarget?.name || ""}
        passcode={qrTarget?.passcode || ""}
        onClose={() => setQrTarget(null)}
      />

      <SimpleInputModal
        visible={displayNameModalVisible}
        title="Your display name"
        placeholder="Enter your name"
        value={displayNameValue}
        onChangeText={setDisplayNameValue}
        onSubmit={handleSaveDisplayName}
        submitLabel="Save"
        onClose={() => setDisplayNameModalVisible(false)}
      />
    </View>
  );
}

// -------------------------------------------------------------------------
// Sub-components
// -------------------------------------------------------------------------

function Breadcrumbs({ path, onNavigate }) {
  return (
    <View style={styles.breadcrumbs}>
      <TouchableOpacity onPress={() => onNavigate([])}>
        <Text style={styles.breadcrumbRoot}>🏠 DigiSpot</Text>
      </TouchableOpacity>
      {path.map((segment, i) => (
        <View key={segment + i} style={styles.breadcrumbItem}>
          <Text style={styles.breadcrumbSep}>/</Text>
          <TouchableOpacity onPress={() => onNavigate(path.slice(0, i + 1))}>
            <Text style={styles.breadcrumbText}>{segment}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

function SimpleInputModal({
  visible,
  title,
  placeholder,
  value,
  onChangeText,
  onSubmit,
  submitLabel,
  onClose,
}) {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TextInput
            style={styles.textInput}
            placeholder={placeholder}
            placeholderTextColor="#9AA1AC"
            value={value}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmit}
          />
          <View style={styles.modalButtonRow}>
            <TouchableOpacity
              style={styles.modalButtonSecondary}
              onPress={onClose}
            >
              <Text style={styles.actionButtonTextSecondary}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalButtonPrimary}
              onPress={onSubmit}
            >
              <Text style={styles.actionButtonText}>{submitLabel}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function FolderActionsModal({ visible, title, actions, onClose }) {
  const runAction = (action) => {
    onClose();
    action.onPress?.();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          {actions.map((action, i) => (
            <TouchableOpacity
              key={action.text + i}
              style={styles.actionSheetRow}
              onPress={() => runAction(action)}
            >
              <Text
                style={[
                  styles.actionSheetRowText,
                  action.destructive && styles.actionSheetRowTextDestructive,
                ]}
              >
                {action.text}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.actionSheetRow, styles.actionSheetCancelRow]}
            onPress={onClose}
          >
            <Text style={styles.actionSheetRowTextSecondary}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// Renders DisplayFolderQR inside the same bottom-sheet chrome as the other
// modals here, rather than pushing a real navigation route — nothing else
// in this file uses a navigator, so a modal keeps this consistent with
// SimpleInputModal/FolderActionsModal above.
function FolderQRModal({ visible, folderName, passcode, onClose }) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>QR for "{folderName}"</Text>
          <Text style={styles.modalTitle}>
            {<DisplayFolderQR passcode={passcode} />}
          </Text>
          <TouchableOpacity style={styles.modalButtonPrimary} onPress={onClose}>
            <Text style={styles.actionButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// -------------------------------------------------------------------------
// Styles
// -------------------------------------------------------------------------

const ACCENT = "#3B6FE0";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F8FA" },
  scrollContent: { padding: 16, paddingBottom: 100 },

  breadcrumbs: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E5EA",
  },
  breadcrumbRoot: { fontSize: 14, fontWeight: "600", color: ACCENT },
  breadcrumbItem: { flexDirection: "row", alignItems: "center" },
  breadcrumbSep: { marginHorizontal: 6, color: "#9AA1AC" },
  breadcrumbText: { fontSize: 14, fontWeight: "600", color: "#1E2230" },

  displayNamePill: {
    alignSelf: "flex-start",
    marginTop: 10,
    marginLeft: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#EEF1F6",
  },
  displayNamePillText: { fontSize: 11, color: "#5A6172", fontWeight: "600" },

  authorSub: { fontSize: 10, color: "#9AA1AC", marginTop: 2 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8A93A3",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 12,
  },

  folderGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  folderCard: {
    width: "31%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E2E5EA",
  },
  folderIcon: { fontSize: 28, marginBottom: 6 },
  folderName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1E2230",
    maxWidth: "90%",
  },

  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E2E5EA",
  },
  fileIcon: { fontSize: 22, marginRight: 12 },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: "600", color: "#1E2230" },
  fileSub: { fontSize: 11, color: "#9AA1AC", marginTop: 2 },

  emptyState: { alignItems: "center", marginTop: 60 },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  emptyText: { fontSize: 15, fontWeight: "600", color: "#4B5563" },
  emptySubtext: {
    fontSize: 12,
    color: "#9AA1AC",
    marginTop: 4,
    textAlign: "center",
  },

  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    padding: 16,
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E2E5EA",
  },
  actionButton: {
    flex: 1,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  actionButtonSecondary: { backgroundColor: "#EEF1F6" },
  actionButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  actionButtonTextSecondary: {
    color: "#3A4150",
    fontWeight: "700",
    fontSize: 14,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 18, 25, 0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1E2230",
    marginBottom: 12,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#E2E5EA",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
  },

  modalButtonRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  modalButtonPrimary: {
    flex: 1,
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalButtonSecondary: {
    flex: 1,
    backgroundColor: "#EEF1F6",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },

  actionSheetRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E5EA",
  },
  actionSheetRowText: {
    fontSize: 15,
    fontWeight: "600",
    color: ACCENT,
  },
  actionSheetRowTextDestructive: { color: "#D64545" },
  actionSheetCancelRow: { borderBottomWidth: 0, marginTop: 4 },
  actionSheetRowTextSecondary: {
    fontSize: 15,
    fontWeight: "600",
    color: "#5A6172",
  },
});
