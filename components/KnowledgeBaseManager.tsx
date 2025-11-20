/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown, X, FileText, Upload, Check, Search, Loader2, FileCode, File, FileImage, FileSpreadsheet, Globe, Layers, MessageSquarePlus, History, Book, MessageSquare } from 'lucide-react';
import { KnowledgeGroup, KnowledgeItem, ChatSession } from '../types';
import * as pdfjsLib from 'pdfjs-dist';

// Set up the PDF.js worker to handle parsing in the background.
// The worker is loaded from a CDN via esm.sh, as configured in index.html's importmap.
// We provide the full URL to the worker script, using the same semver range
// as the importmap to ensure version consistency between the library and the worker.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.5.136/build/pdf.worker.mjs';


interface KnowledgeBaseManagerProps {
  items: KnowledgeItem[];
  onAddItem: (item: KnowledgeItem) => void;
  onAddFiles: (files: { name: string; content: string; mimeType: string }[]) => void;
  onRemoveItem: (item: KnowledgeItem) => void;
  maxItems?: number;
  knowledgeGroups: KnowledgeGroup[];
  activeKnowledgeGroupId: string;
  onSetGroupId: (id: string) => void;
  onAddGroup: (name: string) => void;
  onRemoveGroup: (id: string) => void;
  onMoveItemsAndDeleteGroup: (sourceId: string, destinationId: string) => void;
  onCloseSidebar?: () => void;
  chatScope: 'current' | 'all';
  onSetChatScope: (scope: 'current' | 'all') => void;
  
  // History Props
  chatHistory?: ChatSession[];
  currentSessionId?: string | null;
  onLoadSession?: (session: ChatSession) => void;
  onDeleteSession?: (id: string) => void;
  onNewChat?: () => void;
}

type DeleteModalState = 'hidden' | 'confirm-simple' | 'confirm-move';
type SidebarTab = 'knowledge' | 'history';

const KnowledgeBaseManager: React.FC<KnowledgeBaseManagerProps> = ({ 
  items, 
  onAddItem,
  onAddFiles,
  onRemoveItem,
  maxItems = 20,
  knowledgeGroups,
  activeKnowledgeGroupId,
  onSetGroupId,
  onAddGroup,
  onRemoveGroup,
  onMoveItemsAndDeleteGroup,
  onCloseSidebar,
  chatScope,
  onSetChatScope,
  chatHistory = [],
  currentSessionId,
  onLoadSession,
  onDeleteSession,
  onNewChat
}) => {
  const [activeTab, setActiveTab] = useState<SidebarTab>('knowledge');
  const [currentUrlInput, setCurrentUrlInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState<{name: string}[]>([]);
  
  const [deleteModalState, setDeleteModalState] = useState<DeleteModalState>('hidden');
  const [moveTargetGroupId, setMoveTargetGroupId] = useState('');
  const [itemToDelete, setItemToDelete] = useState<KnowledgeItem | null>(null);

  const otherGroups = knowledgeGroups.filter(g => g.id !== activeKnowledgeGroupId);
  const activeGroup = knowledgeGroups.find(g => g.id === activeKnowledgeGroupId);

  const isValidUrl = (urlString: string): boolean => {
    try {
      new URL(urlString);
      return true;
    } catch (e) {
      return false;
    }
  };

  const handleAddUrl = () => {
    setError(null);
    if (!currentUrlInput.trim()) {
      setError('URL cannot be empty.');
      return;
    }
    if (!isValidUrl(currentUrlInput)) {
      setError('Invalid URL format. Please include http:// or https://');
      return;
    }
    if (items.length >= maxItems) {
      setError(`Maximum of ${maxItems} items reached for this group.`);
      return;
    }
    if (items.some(item => item.type === 'url' && item.value === currentUrlInput)) {
      setError('This URL has already been added.');
      return;
    }
    onAddItem({ type: 'url', value: currentUrlInput });
    setCurrentUrlInput('');
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (items.length + files.length > maxItems) {
      setError(`Cannot add ${files.length} files. Maximum of ${maxItems} items reached.`);
      event.target.value = '';
      return;
    }

    // Set uploading state
    setUploadingFiles(Array.from(files).map(f => ({ name: f.name })));

    const filePromises = Array.from(files).map((file: File) => {
      return new Promise<{ name: string; content: string; mimeType: string }>((resolve, reject) => {
        // PDF file handling
        if (file.type === 'application/pdf') {
          const reader = new FileReader();
          reader.onload = async (e) => {
            const arrayBuffer = e.target?.result;
            if (arrayBuffer instanceof ArrayBuffer) {
              try {
                const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                  const page = await pdf.getPage(i);
                  const textContent = await page.getTextContent();
                  let pageText = '';

                  // Refined PDF Parsing Logic
                  if (textContent.items.length > 0) {
                      const items = textContent.items as any[];
                      
                      // Group items into visual lines based on Y-coordinate
                      // Using a tolerance of 50% of item height to group aligned text
                      const lines: { y: number; height: number; items: any[] }[] = [];
                      
                      items.forEach((item) => {
                          const str = item.str;
                          if (!str || !str.trim()) return; // Skip empty/whitespace items

                          const y = item.transform[5]; // translateY
                          const height = item.height || 10;
                          
                          // Find line bucket
                          const line = lines.find(l => Math.abs(l.y - y) < (height * 0.5));
                          
                          if (line) {
                              line.items.push(item);
                          } else {
                              lines.push({ y, height, items: [item] });
                          }
                      });
                      
                      // Sort lines top-to-bottom (PDF coordinate origin is bottom-left, so higher Y is top)
                      lines.sort((a, b) => b.y - a.y);
                      
                      lines.forEach((line, index) => {
                          // Sort items left-to-right
                          line.items.sort((a, b) => a.transform[4] - b.transform[4]);
                          
                          const lineStr = line.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
                          
                          if (index > 0) {
                              const prevLine = lines[index - 1];
                              const verticalGap = prevLine.y - line.y;
                              
                              // Threshold for paragraph break (1.6x line height)
                              if (verticalGap > prevLine.height * 1.6) {
                                  pageText += '\n\n';
                              } else {
                                  pageText += '\n';
                              }
                          }
                          pageText += lineStr;
                      });
                  }
                  
                  fullText += pageText + '\n\n';
                }
                resolve({ name: file.name, content: fullText.trim(), mimeType: file.type });
              } catch (e: unknown) {
                console.error(`Error parsing PDF "${file.name}":`, e);
                let message = `Failed to parse PDF file: ${file.name}.`;
                
                // Safe error property access
                const errorName = (e as any)?.name;

                if (errorName === 'PasswordException') {
                    message = `Could not open "${file.name}". The PDF is password-protected.`;
                } else if (errorName === 'InvalidPDFException') {
                    message = `Could not open "${file.name}". The file appears to be corrupted or is not a valid PDF.`;
                } else {
                    message = `An unexpected error occurred while processing "${file.name}". It might be an unsupported format.`;
                }
                reject(new Error(message));
              }
            } else {
              reject(new Error('Failed to read PDF file as ArrayBuffer.'));
            }
          };
          reader.onerror = () => reject(new Error(`Error reading file: ${file.name}`));
          reader.readAsArrayBuffer(file);
        } 
        // Text file handling (also covers HTML)
        else {
          const reader = new FileReader();
          reader.onload = (e) => {
            const text = e.target?.result;
            if (typeof text === 'string') {
              resolve({ name: file.name, content: text, mimeType: file.type });
            } else {
              reject(new Error('Failed to read file content as text.'));
            }
          };
          reader.onerror = () => reject(new Error(`Error reading file: ${file.name}`));
          reader.readAsText(file);
        }
      });
    });

    Promise.all(filePromises)
      .then(fileData => {
        onAddFiles(fileData);
      })
      .catch((err: unknown) => {
        console.error("Error reading files:", err);
        const errorMessage = (err instanceof Error) ? err.message : "An error occurred while reading the files.";
        setError(errorMessage);
      })
      .finally(() => {
        setUploadingFiles([]);
      });
    
    event.target.value = '';
  };
  
  const handleConfirmAddGroup = () => {
    if (newGroupName.trim()) {
      onAddGroup(newGroupName.trim());
      setNewGroupName('');
      setIsAddingGroup(false);
    }
  };

  const handleStartDelete = () => {
    const groupIsNotEmpty = activeGroup && activeGroup.items.length > 0;
    if (groupIsNotEmpty) {
      if (otherGroups.length > 0) {
        setMoveTargetGroupId(otherGroups[0].id);
        setDeleteModalState('confirm-move');
      } else {
        // This case shouldn't be reachable if delete is disabled for the last group, but as a fallback:
        setError("Cannot delete a group with items if no other group exists to move them to.");
      }
    } else {
      setDeleteModalState('confirm-simple');
    }
  };

  const handleConfirmSimpleDelete = () => {
    onRemoveGroup(activeKnowledgeGroupId);
    setDeleteModalState('hidden');
  };

  const handleConfirmMoveAndDelete = () => {
    if (moveTargetGroupId) {
      onMoveItemsAndDeleteGroup(activeKnowledgeGroupId, moveTargetGroupId);
      setDeleteModalState('hidden');
      setMoveTargetGroupId('');
    }
  };
  
  const filteredItems = items.filter(item => {
    if (!searchQuery) return true;
    const lowercasedQuery = searchQuery.toLowerCase();
    if (item.type === 'url') {
      return item.value.toLowerCase().includes(lowercasedQuery);
    }
    if (item.type === 'file') {
      return item.name.toLowerCase().includes(lowercasedQuery);
    }
    return false;
  });

  const renderDeleteModal = () => {
    if (deleteModalState === 'hidden') return null;

    const activeGroupName = activeGroup?.name || "Unknown Group";
    
    const destinationGroup = knowledgeGroups.find(g => g.id === moveTargetGroupId);
    const numItemsInSource = activeGroup?.items.length ?? 0;
    const numItemsInDest = destinationGroup?.items.length ?? 0;
    const newTotal = numItemsInSource + numItemsInDest;
    const willOverflow = newTotal > maxItems;
    const numItemsThatWillBeMoved = willOverflow ? Math.max(0, maxItems - numItemsInDest) : numItemsInSource;

    return (
      <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4" aria-modal="true" role="dialog">
        <div className="relative w-full max-w-md p-6 bg-white dark:bg-[#2C2C2C] rounded-xl shadow-lg border border-gray-200 dark:border-white/10">
          <button 
            onClick={() => setDeleteModalState('hidden')} 
            className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-800 dark:hover:text-white rounded-full hover:bg-gray-200 dark:hover:bg-white/10"
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>

          {deleteModalState === 'confirm-simple' && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Delete "{activeGroupName}"?</h3>
              <p className="text-sm text-gray-500 dark:text-[#A8ABB4] mt-2">This group is empty. Are you sure you want to permanently delete it? This action cannot be undone.</p>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setDeleteModalState('hidden')}
                  className="flex-1 h-9 px-4 text-sm rounded-lg transition-colors bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-white/[.12] dark:hover:bg-white/20 dark:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSimpleDelete}
                  className="flex-1 h-9 px-4 text-sm rounded-lg transition-colors bg-red-500 hover:bg-red-600 text-white font-semibold dark:bg-[#f87171]/80 dark:hover:bg-[#f87171]"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
          
          {deleteModalState === 'confirm-move' && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Move Items & Delete Group</h3>
              <p className="text-sm text-gray-500 dark:text-[#A8ABB4] mt-2">
                The group "{activeGroupName}" contains {numItemsInSource} item(s). To delete it, please select a new group to move them to.
              </p>
              
              <div className="mt-4">
                <label htmlFor="move-target-group-modal" className="block text-sm font-medium text-gray-500 dark:text-[#A8ABB4] mb-1">
                  Move items to:
                </label>
                <div className="relative">
                  <select
                    id="move-target-group-modal"
                    value={moveTargetGroupId}
                    onChange={(e) => setMoveTargetGroupId(e.target.value)}
                    className="w-full h-9 py-1 pl-3 pr-8 appearance-none border border-gray-300 dark:border-[rgba(255,255,255,0.1)] bg-gray-100 dark:bg-[#3a3a3a] text-gray-800 dark:text-[#E2E2E2] rounded-md focus:ring-1 focus:ring-blue-500 dark:focus:ring-white/20 focus:border-blue-500 dark:focus:border-white/20 text-sm"
                  >
                    {otherGroups.map(group => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-[#A8ABB4] pointer-events-none"
                    aria-hidden="true"
                  />
                </div>
              </div>
              
              {willOverflow && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 p-2 bg-amber-100 dark:bg-amber-500/10 rounded-md">
                    Warning: Moving {numItemsInSource} items will exceed the destination's capacity. Only {numItemsThatWillBeMoved} items (those not already present) will be moved.
                  </p>
              )}

              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setDeleteModalState('hidden')}
                  className="flex-1 h-9 px-4 text-sm rounded-lg transition-colors bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-white/[.12] dark:hover:bg-white/20 dark:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmMoveAndDelete}
                  className="flex-1 h-9 px-4 text-sm rounded-lg transition-colors bg-red-500 hover:bg-red-600 text-white font-semibold dark:bg-[#f87171]/80 dark:hover:bg-[#f87171]"
                >
                  Move & Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderDeleteItemModal = () => {
    if (!itemToDelete) return null;

    const itemName = itemToDelete.type === 'url' ? itemToDelete.value : itemToDelete.name;

    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" aria-modal="true" role="dialog">
        <div className="relative w-full max-w-md p-6 bg-white dark:bg-[#2C2C2C] rounded-xl shadow-lg border border-gray-200 dark:border-white/10">
          <button 
            onClick={() => setItemToDelete(null)} 
            className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-800 dark:hover:text-white rounded-full hover:bg-gray-200 dark:hover:bg-white/10"
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
          
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Delete Document?</h3>
            <p className="text-sm text-gray-500 dark:text-[#A8ABB4] mt-2 break-all">
              Are you sure you want to permanently delete: <br />
              <strong className="text-gray-800 dark:text-white font-medium">{itemName}</strong>?
            </p>
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={() => setItemToDelete(null)}
                className="flex-1 h-9 px-4 text-sm rounded-lg transition-colors bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-white/[.12] dark:hover:bg-white/20 dark:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onRemoveItem(itemToDelete);
                  setItemToDelete(null);
                }}
                className="flex-1 h-9 px-4 text-sm rounded-lg transition-colors bg-red-500 hover:bg-red-600 text-white font-semibold dark:bg-[#f87171]/80 dark:hover:bg-[#f87171]"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 bg-white dark:bg-[#1E1E1E] shadow-md rounded-xl h-full flex flex-col border border-gray-200 dark:border-[rgba(255,255,255,0.05)] overflow-hidden">
      
      {/* Sidebar Header & Tabs */}
      <div className="flex items-center justify-between mb-3">
        <button
            onClick={onNewChat}
            className="flex-1 mr-2 h-9 px-3 flex items-center justify-center gap-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm"
        >
            <MessageSquarePlus size={18} />
            <span>New Chat</span>
        </button>
        
        {onCloseSidebar && (
          <button
            onClick={onCloseSidebar}
            className="p-2 text-gray-500 dark:text-[#A8ABB4] hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-200 dark:hover:bg-white/10 transition-colors md:hidden"
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div className="flex p-1 mb-4 bg-gray-100 dark:bg-[#252525] rounded-lg border border-gray-200 dark:border-white/5">
        <button
            onClick={() => setActiveTab('knowledge')}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === 'knowledge'
                ? 'bg-white dark:bg-[#3a3a3a] text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
        >
            <Book size={14} />
            <span>Knowledge</span>
        </button>
        <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === 'history'
                ? 'bg-white dark:bg-[#3a3a3a] text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
        >
            <History size={14} />
            <span>History</span>
        </button>
      </div>

      {/* Content Area based on Tab */}
      {activeTab === 'knowledge' ? (
        // --- KNOWLEDGE TAB CONTENT (Existing functionality) ---
        <>
        <div className="mb-4 space-y-5">
            
            {/* Chat Scope Toggle */}
            <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-[#6b7280] uppercase tracking-wider mb-2">
                    Chat Context
                </label>
                <div className="bg-gray-100 dark:bg-[#252525] p-1 rounded-lg flex text-xs font-medium border border-gray-200 dark:border-[rgba(255,255,255,0.05)]">
                    <button
                        onClick={() => onSetChatScope('current')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md transition-all duration-200 ${
                            chatScope === 'current' 
                            ? 'bg-white dark:bg-[#3a3a3a] text-blue-600 dark:text-blue-400 shadow-sm ring-1 ring-gray-200 dark:ring-white/10 font-semibold' 
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                        }`}
                    >
                        <Layers size={14} />
                        <span>Current Group</span>
                    </button>
                    <button
                        onClick={() => onSetChatScope('all')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md transition-all duration-200 ${
                            chatScope === 'all' 
                            ? 'bg-white dark:bg-[#3a3a3a] text-blue-600 dark:text-blue-400 shadow-sm ring-1 ring-gray-200 dark:ring-white/10 font-semibold' 
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                        }`}
                    >
                        <Globe size={14} />
                        <span>All Groups</span>
                    </button>
                </div>
            </div>

            {/* Active Group Management */}
            <div>
                <label htmlFor="url-group-select-kb" className="block text-xs font-bold text-gray-500 dark:text-[#6b7280] uppercase tracking-wider mb-2">
                    Active Group
                </label>
                <div className={`flex items-center gap-2 transition-opacity duration-200 ${chatScope === 'all' ? 'opacity-60' : 'opacity-100'}`}>
                <div className="relative flex-grow">
                    <div className="relative w-full">
                    <select
                        id="url-group-select-kb"
                        value={activeKnowledgeGroupId}
                        onChange={(e) => onSetGroupId(e.target.value)}
                        disabled={isAddingGroup || chatScope === 'all'}
                        className="w-full h-9 py-1 pl-3 pr-8 appearance-none border border-gray-300 dark:border-[rgba(255,255,255,0.1)] bg-gray-100 dark:bg-[#2C2C2C] text-gray-800 dark:text-[#E2E2E2] rounded-md focus:ring-1 focus:ring-blue-500 dark:focus:ring-white/20 focus:border-blue-500 dark:focus:border-white/20 text-sm disabled:cursor-not-allowed truncate transition-colors"
                        >
                        {knowledgeGroups.map(group => (
                            <option key={group.id} value={group.id}>
                            {group.name}
                            </option>
                        ))}
                        </select>
                        <ChevronDown
                        className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-[#A8ABB4] pointer-events-none"
                        aria-hidden="true"
                        />
                    </div>
                </div>
                <button
                    onClick={handleStartDelete}
                    disabled={knowledgeGroups.length <= 1 || isAddingGroup || chatScope === 'all'}
                    className="h-9 w-9 p-1.5 text-gray-500 dark:text-[#A8ABB4] hover:text-red-500 dark:hover:text-[#f87171] rounded-md hover:bg-red-500/10 dark:hover:bg-[rgba(255,0,0,0.1)] transition-colors disabled:text-gray-300 dark:disabled:text-[#4A4A4A] disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 border border-transparent"
                    aria-label="Delete active group"
                    title="Delete active group"
                >
                    <Trash2 size={16} />
                </button>
                </div>
                
                {chatScope === 'all' && (
                    <div className="mt-2 p-2.5 bg-gray-50 dark:bg-[#252525] rounded border border-gray-100 dark:border-white/5 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
                        Group selection is disabled in <b>All Groups</b> mode. Switch context to <b>Current Group</b> to change the active group or add new ones.
                    </div>
                )}
            </div>
            
            <div className="mt-1">
            {isAddingGroup ? (
                <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Enter new group name..."
                    className="flex-grow h-9 py-1 px-2.5 border border-gray-300 dark:border-[rgba(255,255,255,0.1)] bg-gray-50 dark:bg-[#2C2C2C] text-gray-800 dark:text-[#E2E2E2] placeholder-gray-400 dark:placeholder-[#777777] rounded-lg focus:ring-1 focus:ring-blue-500 dark:focus:ring-white/20 focus:border-blue-500 dark:focus:border-white/20 transition-shadow text-sm"
                    onKeyPress={(e) => e.key === 'Enter' && handleConfirmAddGroup()}
                    autoFocus
                />
                <button
                    onClick={handleConfirmAddGroup}
                    disabled={!newGroupName.trim()}
                    className="h-9 w-9 p-1.5 bg-gray-800 hover:bg-gray-900 text-white dark:bg-white/[.12] dark:hover:bg-white/20 dark:text-white rounded-lg transition-colors disabled:bg-gray-300 dark:disabled:bg-[#4A4A4A] disabled:text-gray-500 dark:disabled:text-[#777777] flex items-center justify-center flex-shrink-0"
                    aria-label="Save new group"
                >
                    <Check size={16} />
                </button>
                <button
                    onClick={() => { setIsAddingGroup(false); setNewGroupName(''); }}
                    className="h-9 w-9 p-1.5 text-gray-500 dark:text-[#A8ABB4] hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-200 dark:hover:bg-white/10 transition-colors flex-shrink-0"
                    aria-label="Cancel adding group"
                >
                    <X size={16} />
                </button>
                </div>
            ) : (
                <button
                onClick={() => setIsAddingGroup(true)}
                disabled={chatScope === 'all'}
                className={`w-full h-9 px-3 py-1.5 flex items-center justify-center gap-1.5 text-sm rounded-lg transition-colors ${
                    chatScope === 'all'
                    ? 'bg-gray-100 dark:bg-[#2C2C2C] text-gray-400 dark:text-[#666] cursor-not-allowed'
                    : 'bg-gray-800 hover:bg-gray-900 text-white dark:bg-white/[.12] dark:hover:bg-white/20'
                }`}
                title={chatScope === 'all' ? "Switch to Current Group to add a new group" : "Add new group"}
                >
                <Plus size={14} />
                <span>New Group</span>
                </button>
            )}
            </div>
        </div>

        <div className="flex flex-col flex-grow min-h-0 overflow-hidden">
            <div className="flex items-center gap-2 mb-1 flex-shrink-0">
            <input
                type="url"
                value={currentUrlInput}
                onChange={(e) => setCurrentUrlInput(e.target.value)}
                placeholder="Add a URL..."
                className="flex-grow h-8 py-1 px-2.5 border border-gray-300 dark:border-[rgba(255,255,255,0.1)] bg-gray-50 dark:bg-[#2C2C2C] text-gray-800 dark:text-[#E2E2E2] placeholder-gray-400 dark:placeholder-[#777777] rounded-lg focus:ring-1 focus:ring-blue-500 dark:focus:ring-white/20 focus:border-blue-500 dark:focus:border-white/20 transition-shadow text-sm min-w-0"
                onKeyPress={(e) => e.key === 'Enter' && handleAddUrl()}
                aria-label="Add URL to knowledge base"
            />
            <button
                onClick={handleAddUrl}
                disabled={items.length >= maxItems}
                className="h-8 w-8 p-1.5 bg-gray-800 hover:bg-gray-900 text-white dark:bg-white/[.12] dark:hover:bg-white/20 dark:text-white rounded-lg transition-colors disabled:bg-gray-300 dark:disabled:bg-[#4A4A4A] disabled:text-gray-500 dark:disabled:text-[#777777] flex items-center justify-center flex-shrink-0"
                aria-label="Add URL"
            >
                <Plus size={16} />
            </button>
            </div>
            <div className="flex items-center gap-2 mb-3 flex-shrink-0">
            <input 
                type="file" 
                id="file-upload" 
                multiple 
                className="hidden"
                onChange={handleFileChange}
                accept=".md,.mdx,.txt,.pdf,.html,.htm"
                disabled={items.length >= maxItems || uploadingFiles.length > 0}
            />
            <label 
                htmlFor="file-upload"
                className={`w-full text-center h-8 px-3 py-1.5 flex items-center justify-center gap-2 text-sm rounded-lg transition-colors ${items.length >= maxItems || uploadingFiles.length > 0 ? 'bg-gray-300 dark:bg-[#4A4A4A] text-gray-500 dark:text-[#777777] cursor-not-allowed' : 'bg-gray-800 hover:bg-gray-900 text-white dark:bg-white/[.12] dark:hover:bg-white/20 dark:text-white cursor-pointer'}`}
                aria-disabled={items.length >= maxItems || uploadingFiles.length > 0}
            >
                {uploadingFiles.length > 0 ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploadingFiles.length > 0 ? 'Uploading...' : 'Upload Local Files'}
            </label>
            </div>

            {error && <p className="text-xs text-red-500 dark:text-[#f87171] mb-2">{error}</p>}
            {items.length >= maxItems && <p className="text-xs text-amber-500 dark:text-[#fbbf24] mb-2">Maximum {maxItems} items reached for this group.</p>}
            
            <div className="relative mb-3 flex-shrink-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#777777]" aria-hidden="true" />
            <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search documents..."
                className="w-full h-8 py-1 pl-9 pr-3 border border-gray-300 dark:border-[rgba(255,255,255,0.1)] bg-gray-50 dark:bg-[#2C2C2C] text-gray-800 dark:text-[#E2E2E2] placeholder-gray-400 dark:placeholder-[#777777] rounded-lg focus:ring-1 focus:ring-blue-500 dark:focus:ring-white/20 focus:border-blue-500 dark:focus:border-white/20 transition-shadow text-sm"
                aria-label="Search documents in the current group"
            />
            </div>

            <div className="flex-grow overflow-y-auto space-y-2 chat-container min-h-0">
            {items.length > 0 && filteredItems.length === 0 && uploadingFiles.length === 0 && (
                <p className="text-gray-500 dark:text-[#777777] text-center py-3 text-sm">No documents match your search.</p>
            )}
            {items.length === 0 && uploadingFiles.length === 0 && (
                <p className="text-gray-500 dark:text-[#777777] text-center py-3 text-sm">Add documents to "{activeGroup?.name || 'this group'}" to start querying.</p>
            )}

            {uploadingFiles.map((file, index) => (
                <div key={`uploading-${index}`} className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-[#2C2C2C]/50 border border-gray-200 dark:border-[rgba(255,255,255,0.05)] rounded-lg opacity-70">
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                    <Loader2 size={16} className="text-blue-500 dark:text-blue-400 animate-spin flex-shrink-0" />
                    <span className="text-xs text-gray-600 dark:text-gray-400 truncate italic flex-1">{file.name}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium px-2">Processing...</span>
                </div>
            ))}

            {filteredItems.map((item, index) => (
                <div key={`${item.type}-${index}`} className="relative group">
                <div className="flex items-center justify-between p-2.5 bg-gray-100 dark:bg-[#2C2C2C] border border-gray-200 dark:border-[rgba(255,255,255,0.05)] rounded-lg hover:shadow-sm transition-shadow overflow-hidden">
                    <div className="flex-1 flex items-center gap-2 min-w-0 overflow-hidden">
                    {item.type === 'url' ? (
                        <a href={item.value} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-blue-600 hover:underline dark:text-[#79B8FF] w-full min-w-0" title={item.value}>
                        <img
                            src={`https://www.google.com/s2/favicons?sz=16&domain_url=${encodeURIComponent(item.value)}`}
                            alt="Favicon"
                            className="w-4 h-4 flex-shrink-0 rounded-sm"
                            width="16"
                            height="16"
                        />
                        <span className="truncate flex-1 min-w-0">{item.value}</span>
                        </a>
                    ) : (
                        <>
                        {(() => {
                            const ext = item.name.split('.').pop()?.toLowerCase() || '';
                            
                            if (item.mimeType === 'application/pdf' || ext === 'pdf') {
                            return <FileText size={16} className="text-red-500 dark:text-red-400 flex-shrink-0"/>;
                            }
                            if (['md', 'mdx'].includes(ext)) {
                            return <FileCode size={16} className="text-blue-600 dark:text-blue-400 flex-shrink-0"/>;
                            }
                            if (['html', 'htm'].includes(ext)) {
                            return <FileCode size={16} className="text-orange-600 dark:text-orange-500 flex-shrink-0"/>;
                            }
                            if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
                            return <FileImage size={16} className="text-purple-500 dark:text-purple-400 flex-shrink-0"/>;
                            }
                            if (['xlsx', 'xls', 'csv'].includes(ext)) {
                            return <FileSpreadsheet size={16} className="text-green-600 dark:text-green-400 flex-shrink-0"/>;
                            }
                            if (['docx', 'doc'].includes(ext)) {
                            return <FileText size={16} className="text-blue-700 dark:text-blue-300 flex-shrink-0"/>;
                            }
                            if (['pptx', 'ppt'].includes(ext)) {
                            return <File size={16} className="text-orange-500 dark:text-orange-400 flex-shrink-0"/>;
                            }
                            return <File size={16} className="text-gray-400 dark:text-[#A8ABB4] flex-shrink-0"/>;
                        })()}
                        <span className="text-xs text-gray-800 dark:text-white truncate flex-1 min-w-0" title={item.name}>
                            {item.name}
                        </span>
                        </>
                    )}
                    </div>
                    <button 
                    onClick={() => setItemToDelete(item)}
                    className="p-1 text-gray-500 dark:text-[#A8ABB4] hover:text-red-500 dark:hover:text-[#f87171] rounded-md hover:bg-red-500/10 dark:hover:bg-[rgba(255,0,0,0.1)] transition-colors flex-shrink-0 ml-2"
                    aria-label={`Remove ${item.type === 'url' ? item.value : item.name}`}
                    >
                    <Trash2 size={16} />
                    </button>
                </div>
                {item.type === 'file' && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-gray-800 dark:bg-[#3a3a3a] border border-gray-300 dark:border-white/10 text-white text-xs rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    <p className="font-bold mb-1 border-b border-gray-400 dark:border-white/10 pb-1">{item.name}</p>
                    <pre className="whitespace-pre-wrap font-sans text-gray-300">
                        {item.content.substring(0, 250)}{item.content.length > 250 ? '...' : ''}
                    </pre>
                    </div>
                )}
                </div>
            ))}
            </div>
        </div>
        </>
      ) : (
        // --- HISTORY TAB CONTENT ---
        <div className="flex flex-col flex-grow min-h-0 overflow-hidden">
            <div className="flex-grow overflow-y-auto space-y-2 chat-container min-h-0">
                {chatHistory && chatHistory.length > 0 ? (
                    chatHistory.map((session) => (
                        <div 
                            key={session.id} 
                            className={`relative group flex items-center justify-between p-3 rounded-lg cursor-pointer border transition-all ${
                                currentSessionId === session.id 
                                ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30' 
                                : 'bg-gray-50 dark:bg-[#2C2C2C] border-gray-200 dark:border-[rgba(255,255,255,0.05)] hover:border-gray-300 dark:hover:border-white/10'
                            }`}
                            onClick={() => onLoadSession && onLoadSession(session)}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <MessageSquare size={14} className={currentSessionId === session.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'} />
                                    <p className={`text-sm font-medium truncate ${
                                        currentSessionId === session.id ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'
                                    }`}>
                                        {session.title || 'Untitled Conversation'}
                                    </p>
                                </div>
                                <p className="text-[10px] text-gray-500 dark:text-gray-500">
                                    {new Date(session.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteSession && onDeleteSession(session.id);
                                }}
                                className="p-1.5 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-[#f87171] rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Delete chat session"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))
                ) : (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-600">
                        <MessageSquare size={32} className="mb-2 opacity-20" />
                        <p className="text-sm">No saved history yet.</p>
                    </div>
                )}
            </div>
        </div>
      )}
      
      {renderDeleteModal()}
      {renderDeleteItemModal()}
    </div>
  );
};

export default KnowledgeBaseManager;