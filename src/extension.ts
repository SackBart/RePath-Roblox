import * as vscode from 'vscode';
import { convertToRobloxPath } from './PathResolver';
import * as path from 'path';
import * as ignoreManager from './IgnoreManager';
import { createIgnoreFile } from './IgnoreFileCreator';
import { setEngine } from 'crypto';

interface FileMovement {
	oldPath: string,
	newPath: string,
}

interface LongestVariable {
	variable: string,
	longestSnippetCount: number,
	suffix: string,
}

const CONFIGURATION_NAME = "repath";

/**
 * Activates the RePath extension.
 * 
 * @param context - VS Code extension context 
 * 
 * @remarks
 * This extension automatically updates require() paths in Lua/Luau files
 * when module scripts are moved or renamed in a Roblox project.
 */
export function activate(context: vscode.ExtensionContext) {
	console.log('RePath activated');

	const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
	let notifyUserOnChange: boolean | undefined = config.get<boolean>("notifyUserOnChanged");;

	vscode.workspace.onDidChangeConfiguration(event => {
		console.log("[RePath] Changed a setting");
		if (event.affectsConfiguration(CONFIGURATION_NAME + "." + "notifyUserOnChanged")) {
			const config = vscode.workspace.getConfiguration(CONFIGURATION_NAME);
			notifyUserOnChange = config.get<boolean>("notifyUserOnChanged");
			console.log("[RePath] Updated notifyUserOnChanged setting")
		}
	})

	let disposable = vscode.commands.registerCommand('repath.createIgnore', () => {
		createIgnoreFile();
	})
	context.subscriptions.push(disposable);

	vscode.workspace.onDidRenameFiles(async (e) => {
		// We have a file changed its name or got its parent changed
		// Implying that a file exists
		if (e.files.length == 0) {
			return;
		}
		const workspaceEdit = new vscode.WorkspaceEdit();
		const workspaceFolder = await vscode.workspace.getWorkspaceFolder(e.files[0].oldUri);

		if (!workspaceFolder) {
			console.log("[RePath] Not within the workspace folder");
			vscode.window.showErrorMessage("RePath: Not within the workspace folder");
			return;
		}

		if (notifyUserOnChange != null && notifyUserOnChange) {
			const selection = await vscode.window.showInformationMessage(
				`You moved ${e.files.length} file` + (e.files.length == 1 ? "" : "s") + `. Do you want to apply refactoring?`,
				"Yes",
				"No",
			);
			if (selection == "Yes") {
				vscode.window.showInformationMessage("RePath: Starting to refactor...");
			} else {
				return;
			}
		}

		let changeCount = 0;

		const moves: FileMovement[] = [];

		// Save all changes file directories
		for (const file of e.files) {
			const relativePathOld = path.relative(workspaceFolder.uri.fsPath, file.oldUri.fsPath);
			const relativePathNew = path.relative(workspaceFolder.uri.fsPath, file.newUri.fsPath);

			const normalizedOld = relativePathOld.replace(/\\/g, '/');
			const normalizedNew = relativePathNew.replace(/\\/g, '/');

			const oldRobloxPath = convertToRobloxPath(normalizedOld, workspaceFolder);
			const newRobloxPath = convertToRobloxPath(normalizedNew, workspaceFolder);

			if (oldRobloxPath && newRobloxPath && oldRobloxPath != newRobloxPath) {
				console.log(`[RePath] Detected move ${oldRobloxPath} > ${newRobloxPath}`);
				moves.push({ oldPath: oldRobloxPath, newPath: newRobloxPath });
			}
		}

		if (moves.length > 0) {
			const changeCount = await performBatchRefactoring(moves, workspaceEdit, workspaceFolder);

			if (changeCount > 0) {
				const success = await vscode.workspace.applyEdit(workspaceEdit);
				if (success) {
					vscode.window.showInformationMessage(`RePath: Applied changes to ${changeCount} file` + (changeCount == 1 ? "" : "s"));
				} else {
					vscode.window.showErrorMessage("RePath: Couldn't apply edits");
				}
			} else {
				vscode.window.showInformationMessage("RePath: No references found needing update");
			}
		}
	});
}

async function performBatchRefactoring(
	moves: FileMovement[],
	edit: vscode.WorkspaceEdit,
	workspaceFolder: vscode.WorkspaceFolder
): Promise<number> {
	const files = await vscode.workspace.findFiles('**/*.{lua,luau}', '**/node_modules/**');
	const ignoreList = await ignoreManager.getIgnore(workspaceFolder)

	let fileCount = 0;

	for (const fileUri of files) {
		console.log(`[RePath] Looking at file ${fileUri.fsPath}`);

		const rawRelativePath = path.relative(workspaceFolder.uri.fsPath, fileUri.fsPath);
		const relativePathPosix = rawRelativePath.split(path.sep).join(path.posix.sep);
		console.log(`Check ignore for: ${relativePathPosix}`);

		if (ignoreList.ignores(relativePathPosix)) {
			console.log(`[RePath] ${fileUri.fsPath} is excluded`);
			continue;
		}

		const document = await vscode.workspace.openTextDocument(fileUri);
		const originalText = document.getText();

		// We'll work on a copy of the text, in case anything goes wrong
		let currentText = originalText
		let isFileDirty = false

		for (const move of moves) {
			const resultText = applyRefactorOnText(currentText, move.oldPath, move.newPath);
			if (resultText != currentText) {
				currentText = resultText;
				isFileDirty = true;
			}
		}

		if (isFileDirty) {
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(originalText.length)
			)
			edit.replace(fileUri, fullRange, currentText);
			fileCount++;
			console.log(`[RePath] Refactored File ${fileUri.fsPath}`)
		}
	}

	return fileCount;
}

function applyRefactorOnText(text: string, oldPath: string, newPath: string): string {
	// Get the services and the path suffixes from the given paths
	const serviceRegex = /^game:GetService\("([^"]+)"\)(.*)$/;
	const matchOld = oldPath.match(serviceRegex);
	const matchNew = newPath.match(serviceRegex);

	if (!matchOld || !matchNew) {
		console.error("[RePath] Path is not in correct Format");
		return text;
	}

	const oldServiceName = matchOld[1];
	const oldPathSuffix = matchOld[2];
	const newServiceName = matchNew[1];
	const newPathSuffix = matchNew[2];

	// Get the variables that require the services
	const oldServiceRegex = new RegExp(`local\\s+([a-zA-Z_]\\w*)\\s*=\\s*game:GetService\\("${oldServiceName}"\\)`);
	const newServiceRegex = new RegExp(`local\\s+([a-zA-Z_]\\w*)\\s*=\\s*game:GetService\\("${newServiceName}"\\)`);

	const matchOldVariable = oldServiceRegex.exec(text);
	const matchNewVariable = newServiceRegex.exec(text);

	let oldServiceVariable = matchOldVariable ? matchOldVariable[1] : null;
	let newServiceVariable = matchNewVariable ? matchNewVariable[1] : null;

	let newText = text;

	// Look for the path that contains oldVariable.oldPathSuffix or game:GetService("oldServiceName").oldPathSuffix
	if (oldServiceVariable != null && text.includes(oldServiceVariable + oldPathSuffix)) { // Case 1: Variable requiring Service which is then used inside require() 
		// Old Variable has been used
		// Replace path
		const oldGivenPath = oldServiceVariable + oldPathSuffix;

		if (oldServiceVariable == newServiceVariable) {
			// Keep the old variable
			newText = text.replaceAll(oldGivenPath, oldServiceVariable + newPathSuffix);
		} else if (newServiceVariable) {
			// Replace it with the new one since it's a new service
			newText = text.replaceAll(oldGivenPath, newServiceVariable + newPathSuffix);
		} else {
			// Directly require the service and include the path suffix
			newText = text.replaceAll(oldGivenPath, `game:GetService("${newServiceName}")` + newPathSuffix);
		}
	} else if (text.includes(oldPath)) { // Case 2: Directly required
		// Old Variable has been used
		// Replace path
		if (oldServiceVariable == newServiceVariable && oldServiceVariable != null && newServiceVariable != null) {
			// Keep the old variable
			newText = text.replaceAll(oldPath, oldServiceVariable + newPathSuffix);
		} else if (newServiceVariable) {
			// Replace it with the new one since it's a new service
			newText = text.replaceAll(oldPath, newServiceVariable + newPathSuffix);
		} else {
			// Directly require the service and include the path suffix
			newText = text.replaceAll(oldPath, `game:GetService("${newServiceName}")` + newPathSuffix);
		}
	} else {
		console.log("[RePath] Didn't find it. Continuing");
	}


	newText = applyNestedRefactoring(newText, oldPath, newPath);

	return newText;
}

function applyNestedRefactoring(text: string, oldPath: string, newPath: string): string {
	const variableMap = parseVariablesToAbsoluteMap(text);

	console.error("Start");
	console.log("Path", newPath);
	variableMap.forEach((value: string, key: string) => {
		console.log(key, ">", value);
	})
	console.error("Done");

	// Get through all variables
	if (variableMap.size == 0) {
		return text;
	}
	const newPathSnippet = newPath.split(".");
	const oldPathSnippet = oldPath.split(".");
	let calculatedNewPath;
	let calculatedOldPath;
	let biggestVariable: LongestVariable = {
		variable: "",
		longestSnippetCount: 0,
		suffix: newPath,
	};
	let oldPaths = new Array<LongestVariable>();


	variableMap.forEach((relativePath: string, variable: string) => {
		const variablePathSnippet = relativePath.split(".");
		let localBiggest = 0;
		let suffix = "";

		console.log("--------------------");
		console.log("New snippet length:", newPathSnippet.length);
		console.log("Variable snippet length:", variablePathSnippet.length);
		console.log("relativePath:", relativePath);
		// Calculate the biggest snippet that matches the new path
		for (let j = 0; j < newPathSnippet.length; j++) {
			console.log("Iteration", j);
			console.log("Variable snippet still exists:", variablePathSnippet[j] != null);
			console.log(variablePathSnippet[j], "==", newPathSnippet[j], variablePathSnippet[j] == newPathSnippet[j]);
			console.log("-------");
			if (variablePathSnippet[j] != null && variablePathSnippet[j] == newPathSnippet[j]) {
				localBiggest++;
			} else {
				// Get the suffix
				suffix = newPathSnippet.slice(j).join(".");

				console.log("Suffix is", suffix);
				break;
			}
		}
		if (localBiggest > biggestVariable.longestSnippetCount) {
			biggestVariable = {
				variable: variable,
				longestSnippetCount: localBiggest,
				suffix: suffix
			}
		}

		localBiggest = 0;

		// Now calculate the biggest snippet that matches the old path
		for (let j = 0; j < oldPathSnippet.length; j++) {
			if (variablePathSnippet[j] != null && variablePathSnippet[j] == oldPathSnippet[j]) {
				localBiggest++;
			} else {
				// Get the suffix
				suffix = oldPathSnippet.slice(j).join(".");
				console.log("Suffix is", suffix);
				console.log();
				break;
			}
		}
		oldPaths.push({
			variable: variable,
			longestSnippetCount: localBiggest,
			suffix: suffix,
		});
	})
	oldPaths.sort((a, b) => b.longestSnippetCount - a.longestSnippetCount);

	calculatedNewPath = biggestVariable.variable + (biggestVariable.variable == "" || biggestVariable.suffix == "" ? "" : ".") + biggestVariable.suffix;

	console.error("New path:", calculatedNewPath);
	console.error("Old Path:", oldPath);

	oldPaths.forEach(oldPath => {
		let path = oldPath.variable + (oldPath.variable == "" || oldPath.suffix == "" ? "" : ".") + oldPath.suffix;
		console.log("Old path:", path);
		if (text.includes(path)) {
			console.log("Got included so will be replaced")
			text = text.replaceAll(path, calculatedNewPath);
		}
	});

	return text;
}


function parseVariablesToAbsoluteMap(text: string): Map<string, string> {
    const globalVarMap = new Map<string, string>();
    const lines = text.split(/\r?\n/);

    // Regex für: local varName = Wert
    const assignRegex = /^\s*local\s+([a-zA-Z_]\w*)\s*=\s*(.+)/;

    // Regex um zu prüfen, ob es ein Service ist
    const serviceRegex = /^game:GetService\("([^"]+)"\)(.*)$/;

    for (const line of lines) {
        const match = line.match(assignRegex);
        
        if (!match) continue;

        const varName = match[1];
        let rawValue = match[2];

        // 1. Cleanup: Kommentare und Semikolons entfernen
        if (rawValue.includes("--")) rawValue = rawValue.split("--")[0];
        rawValue = rawValue.trim();
        if (rawValue.endsWith(";")) rawValue = rawValue.slice(0, -1).trim();

        // JETZT KOMMT DIE LOGIK:

        // Fall A: Es ist direkt ein Service (Base Case)
        // z.B. local Service = game:GetService("ServerScriptService")
        if (rawValue.match(serviceRegex)) {
            globalVarMap.set(varName, rawValue);
            continue; // Fertig mit dieser Variable
        }

        // Fall B: Es referenziert eine Variable, die wir schon kennen (Recursive Case)
        // z.B. local Test3 = Service.Test3
        
        // Wir splitten bei Punkten: "Service.Test3" -> ["Service", "Test3"]
        const parts = rawValue.split('.');
        const potentialBaseVar = parts[0]; // "Service"

        if (globalVarMap.has(potentialBaseVar)) {
            // AHA! Wir kennen "Service". Holen wir uns den echten Pfad.
            const absoluteBasePath = globalVarMap.get(potentialBaseVar)!;
            
            // Den Rest des Pfades wieder anhängen (.Test3)
            const restOfPath = parts.slice(1).join('.');
            
            // Zusammenbauen: "game:GetService("SSS")" + "." + "Test3"
            const finalAbsolutePath = restOfPath 
                ? `${absoluteBasePath}.${restOfPath}` 
                : absoluteBasePath;

            globalVarMap.set(varName, finalAbsolutePath);
        }
        
        // Fall C: Es ist etwas anderes (require, {}, Zahlen, Strings)
        // Da wir im `if` oben nichts gemacht haben, wird es NICHT in die Map aufgenommen.
        // require(...) beginnt mit "require", das ist nicht in der Map -> wird ignoriert.
        // {} beginnt mit "{", ist nicht in der Map -> wird ignoriert.
    }

    return globalVarMap;
}