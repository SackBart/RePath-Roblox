/**
 * Type definitions for RePath extension
 */

/**
 * Represents a node in the Rojo project tree structure
 */
export interface ProjectTreeNode {
    /** Optional path mapping for this node */
    $path?: string;
    /** Child nodes or other properties */
    [key: string]: ProjectTreeNode | string | undefined;
}

/**
 * Represents the structure of a Rojo project.json file
 */
export interface ProjectJson {
    /** The tree structure defining the Roblox game hierarchy */
    tree: ProjectTreeNode;
    /** Project name */
    name?: string;
    /** Other project properties */
    [key: string]: unknown;
}
