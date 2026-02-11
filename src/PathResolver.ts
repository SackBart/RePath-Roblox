import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectJson, ProjectTreeNode } from './types';

/**
 * Formats a name for use in Roblox path syntax.
 * Names with spaces are wrapped in bracket notation.
 * 
 * @param name - The name to format
 * @returns Formatted name (e.g., "MyModule" or ["My Module"])
 * 
 * @example
 * formatRobloxName("MyModule") // Returns: "MyModule"
 * formatRobloxName("My Module") // Returns: '["My Module"]'
 */
function formatRobloxName(name: string): string {
    if (name.includes(' ')) {
        return `["${name}"]`;
    }
    return name;
}

/**
 * Recursively searches for a target path in the Rojo project tree structure.
 * 
 * @param tree - The project tree node to search
 * @param targetPath - The file system path to find
 * @param currentPath - The current path in the tree (used for recursion)
 * @returns Array of keys representing the path in the tree, or null if not found
 * 
 * @example
 * findPathInTree(projectJson.tree, "src/server", [])
 * // Returns: ["ServerScriptService", "server"]
 */
function findPathInTree(tree: ProjectTreeNode, targetPath: string, currentPath: string[] = []): string[] | null {
    if (typeof tree !== 'object' || tree === null) {
        return null;
    }

    if (tree.$path === targetPath) {
        console.log(`[findPathInTree] Found matching $path: "${targetPath}" at path: [${currentPath.join(', ')}]`);
        return currentPath;
    }

    for (const [key, value] of Object.entries(tree)) {
        if (key.startsWith('$')) {
            continue;
        }
        if (typeof value === 'object' && value !== null) {
            const result = findPathInTree(value as ProjectTreeNode, targetPath, [...currentPath, key]);
            if (result) {
                return result;
            }
        }
    }

    return null;
}

/**
 * Reads and parses the Rojo project.json file from the workspace.
 * 
 * @param workspaceFolder - The VS Code workspace folder
 * @returns Parsed project.json object, or null if not found or invalid
 * 
 * @remarks
 * This function searches for any file ending with '.project.json' in the workspace root.
 * It's used to map file system paths to Roblox game paths.
 */
function getProjectJson(workspaceFolder: vscode.WorkspaceFolder): ProjectJson | null {
    try {
        const workspaceRoot = workspaceFolder.uri.fsPath;
        console.log(`[getProjectJson] Workspace root path: ${workspaceRoot}`);

        const files = fs.readdirSync(workspaceRoot);
        const projectJsonFile = files.find(file => file.endsWith('.project.json'));

        if (projectJsonFile) {
            const projectJsonPath = path.join(workspaceRoot, projectJsonFile);
            console.log(`[getProjectJson] Found project.json file: ${projectJsonFile} at: ${projectJsonPath}`);

            const projectJson = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8')) as ProjectJson;

            // Validate that the project.json has a tree property
            if (!projectJson.tree) {
                console.error('[getProjectJson] Invalid project.json: missing tree property');
                return null;
            }

            console.log(`[getProjectJson] Loaded project.json with tree structure`);
            return projectJson;
        }

        console.log(`[getProjectJson] No .project.json file found in workspace root`);
        return null;
    } catch (error) {
        console.error(`[getProjectJson] Error reading workspace directory: ${error}`);
        return null;
    }
}

/**
 * Converts a file system path to a Roblox game path format.
 * 
 * @param filePath - Relative file path from workspace root (e.g., "src/ServerScriptService/MyModule.lua")
 * @param workspaceFolder - Optional VS Code workspace folder for project.json lookup
 * @returns Roblox path in format: game:GetService("ServiceName").Path.To.Module
 * 
 * @remarks
 * This function handles:
 * - Conversion of filesystem paths to Roblox game paths
 * - Special handling for init files (init.lua, init.luau)
 * - Suffix removal (.server, .client, .shared)
 * - Names with spaces (converted to bracket notation)
 * - Rojo project.json tree mapping
 * 
 * @example
 * convertToRobloxPath("src/ServerScriptService/MyModule.lua")
 * // Returns: game:GetService("ServerScriptService").MyModule
 * 
 * @example
 * convertToRobloxPath("src/ServerScriptService/init.server.lua")
 * // Returns: game:GetService("ServerScriptService")
 */
export function convertToRobloxPath(filePath: string, workspaceFolder?: vscode.WorkspaceFolder): string {
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    console.log(`[convertToRobloxPath] Directory: ${dir}, Filename: ${filename}`);

    let moduleName = filename;
    const lastDotIndex = moduleName.lastIndexOf('.');
    if (lastDotIndex !== -1) {
        const ext = moduleName.substring(lastDotIndex + 1).toLowerCase();
        if (ext === 'lua' || ext === 'luau') {
            moduleName = moduleName.substring(0, lastDotIndex);
            const secondLastDotIndex = moduleName.lastIndexOf('.');
            if (secondLastDotIndex !== -1) {
                const suffix = moduleName.substring(secondLastDotIndex + 1).toLowerCase();
                if (suffix === 'server' || suffix === 'client' || suffix === 'shared') {
                    moduleName = moduleName.substring(0, secondLastDotIndex);
                }
            }
        }
    }
    console.log(`[convertToRobloxPath] Extracted module name: ${moduleName}`);

    let result = 'game';

    if (workspaceFolder) {
        const projectJson = getProjectJson(workspaceFolder);
        if (projectJson && projectJson.tree) {
            const dirPathWithoutFilename = dir.replace(/\\/g, '/');
            console.log(`[convertToRobloxPath] Searching for path in tree: ${dirPathWithoutFilename}`);

            let matchedTreePath: string[] | null = null;
            let remainingPathParts: string[] = [];

            const dirParts = dirPathWithoutFilename.split('/').filter(part => part && part !== '.');
            console.log(`[convertToRobloxPath] Directory parts to search: [${dirParts.join(', ')}]`);

            for (let i = dirParts.length; i >= 0; i--) {
                const testPath = dirParts.slice(0, i).join('/');
                console.log(`[convertToRobloxPath] Testing path in tree: "${testPath}"`);
                const treePath = findPathInTree(projectJson.tree, testPath);
                if (treePath) {
                    matchedTreePath = treePath;
                    remainingPathParts = dirParts.slice(i);
                    console.log(`[convertToRobloxPath] Found match! Tree path: [${matchedTreePath.join(', ')}], Remaining parts: [${remainingPathParts.join(', ')}]`);
                    break;
                }
            }

            if (matchedTreePath && matchedTreePath.length > 0) {
                console.log(`[convertToRobloxPath] Building Roblox path using tree structure`);
                for (let i = 0; i < matchedTreePath.length; i++) {
                    const part = matchedTreePath[i];
                    const formatted = formatRobloxName(part);
                    if (i === 0) {
                        result += `:GetService("${part}")`;
                    } else {
                        if (formatted.startsWith('[')) {
                            result += formatted;
                        } else {
                            result += `.${formatted}`;
                        }
                    }
                }

                for (const part of remainingPathParts) {
                    const formatted = formatRobloxName(part);
                    if (formatted.startsWith('[')) {
                        result += formatted;
                    } else {
                        result += `.${formatted}`;
                    }
                }

                if (!moduleName.toLowerCase().startsWith('init')) {
                    const formattedModuleName = formatRobloxName(moduleName);
                    if (formattedModuleName.startsWith('[')) {
                        result += formattedModuleName;
                    } else {
                        result += `.${formattedModuleName}`;
                    }
                }

                console.log(`[convertToRobloxPath] Final Roblox path (from tree): ${result}`);
                return result;
            } else {
                console.log(`[convertToRobloxPath] No matching path found in tree, falling back to default behavior`);
            }
        }
    }

    console.log(`[convertToRobloxPath] Using fallback path conversion (no project.json or no match)`);
    const dirParts = dir.split('/').filter(part => part && part !== '.');
    if (dirParts.length > 0 && dirParts[0] === 'src') {
        dirParts.shift();
    }
    console.log(`[convertToRobloxPath] Fallback directory parts: [${dirParts.join(', ')}]`);

    for (let i = 0; i < dirParts.length; i++) {
        const part = dirParts[i];
        const formatted = formatRobloxName(part);

        if (i === 0) {
            result += `:GetService("${part}")`;
        } else {
            if (formatted.startsWith('[')) {
                result += formatted;
            } else {
                result += `.${formatted}`;
            }
        }
    }

    if (moduleName.toLowerCase().startsWith('init')) {
        console.log(`[convertToRobloxPath] Module name starts with "init", skipping module name`);
        console.log(`[convertToRobloxPath] Final Roblox path (fallback, init): ${result}`);
        return result;
    }

    const formattedModuleName = formatRobloxName(moduleName);
    if (formattedModuleName.startsWith('[')) {
        result += formattedModuleName;
    } else {
        result += `.${formattedModuleName}`;
    }

    console.log(`[convertToRobloxPath] Final Roblox path (fallback): ${result}`);
    return result;
}