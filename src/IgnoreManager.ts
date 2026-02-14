import * as vscode from 'vscode';
import * as ignore from 'ignore';
import { TextDecoder } from 'util';

const IGNORE_NAME = ".repathignore";

export async function getIgnore(workspaceFolder: vscode.WorkspaceFolder | undefined): Promise<ignore.Ignore> {
    const ig = ignore.default();

    ig.add(['.git', 'node_modules']);

    if (workspaceFolder != null) {
        const ignoreFilePath = vscode.Uri.joinPath(workspaceFolder.uri, IGNORE_NAME);

        try {
            const fileContent = await vscode.workspace.fs.readFile(ignoreFilePath);
            const text = new TextDecoder("utf-8").decode(fileContent);

            ig.add(text);

            console.log(`${IGNORE_NAME} loaded successfully`);
        } catch (error) {
            console.error(`No ${IGNORE_NAME} or it's not readable`);
        }
    }

    return ig;
}