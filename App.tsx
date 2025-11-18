/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChatMessage, MessageSender, KnowledgeGroup, KnowledgeItem } from './types';
import { generateContentWithKnowledgeContext, getInitialSuggestions } from './services/geminiService';
import KnowledgeBaseManager from './components/KnowledgeBaseManager';
import ChatInterface from './components/ChatInterface';

const GEMINI_DOCS_URLS: KnowledgeItem[] = [
  "https://ai.google.dev/gemini-api/docs",
  "https://ai.google.dev/gemini-api/docs/quickstart",
  "https://ai.google.dev/gemini-api/docs/api-key",
  "https://ai.google.dev/gemini-api/docs/libraries",
  "https://ai.google.dev/gemini-api/docs/models",
  "https://ai.google.dev/gemini-api/docs/pricing",
  "https://ai.google.dev/gemini-api/docs/rate-limits",
  "https://ai.google.dev/gemini-api/docs/billing",
  "https://ai.google.dev/gemini-api/docs/changelog",
].map(url => ({ type: 'url', value: url }));

const MODEL_CAPABILITIES_URLS: KnowledgeItem[] = [
  "https://ai.google.dev/gemini-api/docs/text-generation",
  "https://ai.google.dev/gemini-api/docs/image-generation",
  "https://ai.google.dev/gemini-api/docs/video",
  "https://ai.google.dev/gemini-api/docs/speech-generation",
  "https://ai.google.dev/gemini-api/docs/music-generation",
  "https://ai.google.dev/gemini-api/docs/long-context",
  "https://ai.google.dev/gemini-api/docs/structured-output",
  "https://ai.google.dev/gemini-api/docs/thinking",
  "https://ai.google.dev/gemini-api/docs/function-calling",
  "https://ai.google.dev/gemini-api/docs/document-processing",
  "https://ai.google.dev/gemini-api/docs/image-understanding",
  "https://ai.google.dev/gemini-api/docs/video-understanding",
  "https://ai.google.dev/gemini-api/docs/audio",
  "https://ai.google.dev/gemini-api/docs/code-execution",
  "https://ai.google.dev/gemini-api/docs/grounding",
].map(url => ({ type: 'url', value: url }));

const INITIAL_KNOWLEDGE_GROUPS: KnowledgeGroup[] = [
  { id: 'gemini-overview', name: 'Gemini Docs Overview', items: GEMINI_DOCS_URLS },
  { id: 'model-capabilities', name: 'Model Capabilities', items: MODEL_CAPABILITIES_URLS },
];

const loadInitialState = () => {
  let groups: KnowledgeGroup[] = INITIAL_KNOWLEDGE_GROUPS;
  let activeId: string;

  try {
    const savedGroups = localStorage.getItem('DOC_BROWSER_KNOWLEDGE_GROUPS');
    const parsedGroups = savedGroups ? JSON.parse(savedGroups) : null;
    if (parsedGroups && Array.isArray(parsedGroups) && parsedGroups.length > 0) {
      // Data migration for older versions without mimeType on file items
      const migratedGroups = parsedGroups.map((group: any) => ({
        ...group,
        items: group.items.map((item: any) => {
          if (item.type === 'file' && !item.mimeType) {
            const extension = item.name.split('.').pop()?.toLowerCase();
            if (extension === 'pdf') {
              return { ...item, mimeType: 'application/pdf' };
            }
            // Default for old .txt, .md files
            return { ...item, mimeType: 'text/plain' }; 
          }
          return item;
        })
      }));
      groups = migratedGroups;
    }
  } catch (e) {
    console.error("Failed to load/parse knowledge groups from localStorage:", e);
  }

  activeId = groups[0]?.id ?? '';

  try {
    const savedActiveId = localStorage.getItem('DOC_BROWSER_ACTIVE_GROUP_ID');
    if (savedActiveId && groups.some(g => g.id === savedActiveId)) {
      activeId = savedActiveId;
    }
  } catch (e) {
    console.error("Failed to load/parse active group ID from localStorage:", e);
  }
  
  return { initialGroups: groups, initialActiveId: activeId };
};


const App: React.FC = () => {
  const { initialGroups, initialActiveId } = useMemo(() => loadInitialState(), []);
  
  const [knowledgeGroups, setKnowledgeGroups] = useState<KnowledgeGroup[]>(initialGroups);
  const [activeKnowledgeGroupId, setActiveKnowledgeGroupId] = useState<string>(initialActiveId);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [initialQuerySuggestions, setInitialQuerySuggestions] = useState<string[]>([]);
  
  const MAX_ITEMS = 20;

  const activeGroup = knowledgeGroups.find(group => group.id === activeKnowledgeGroupId);
  const currentKnowledgeItems = activeGroup ? activeGroup.items : [];
  
  useEffect(() => {
    try {
      localStorage.setItem('DOC_BROWSER_KNOWLEDGE_GROUPS', JSON.stringify(knowledgeGroups));
      if (activeKnowledgeGroupId && knowledgeGroups.some(g => g.id === activeKnowledgeGroupId)) {
        localStorage.setItem('DOC_BROWSER_ACTIVE_GROUP_ID', activeKnowledgeGroupId);
      }
    } catch (e) {
      console.error("Failed to save state to localStorage:", e);
    }
  }, [knowledgeGroups, activeKnowledgeGroupId]);

   useEffect(() => {
    const apiKey = process.env.API_KEY;
    const currentActiveGroup = knowledgeGroups.find(group => group.id === activeKnowledgeGroupId);
    const welcomeMessageText = !apiKey 
        ? 'ERROR: Gemini API Key (process.env.API_KEY) is not configured. Please set this environment variable to use the application.'
        : `Welcome to Documentation Browser! You're currently browsing content from: "${currentActiveGroup?.name || 'None'}". Just ask me questions, or try one of the suggestions below to get started`;
    
    setChatMessages([{
      id: `system-welcome-${activeKnowledgeGroupId}-${Date.now()}`,
      text: welcomeMessageText,
      sender: MessageSender.SYSTEM,
      timestamp: new Date(),
    }]);
  }, [activeKnowledgeGroupId, knowledgeGroups]); 


  const fetchAndSetInitialSuggestions = useCallback(async (currentItems: KnowledgeItem[]) => {
    if (currentItems.length === 0) {
      setInitialQuerySuggestions([]);
      return;
    }
      
    setIsFetchingSuggestions(true);
    setInitialQuerySuggestions([]); 

    try {
      const response = await getInitialSuggestions(currentItems); 
      let suggestionsArray: string[] = [];
      if (response.text) {
        try {
          let jsonStr = response.text.trim();
          const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s; 
          const match = jsonStr.match(fenceRegex);
          if (match && match[2]) {
            jsonStr = match[2].trim();
          }
          const parsed = JSON.parse(jsonStr);
          if (parsed && Array.isArray(parsed.suggestions)) {
            suggestionsArray = parsed.suggestions.filter((s: unknown) => typeof s === 'string');
          } else {
            console.warn("Parsed suggestions response, but 'suggestions' array not found or invalid:", parsed);
             setChatMessages(prev => [...prev, { id: `sys-err-suggestion-fmt-${Date.now()}`, text: "Received suggestions in an unexpected format.", sender: MessageSender.SYSTEM, timestamp: new Date() }]);
          }
        } catch (parseError) {
          console.error("Failed to parse suggestions JSON:", parseError, "Raw text:", response.text);
          setChatMessages(prev => [...prev, { id: `sys-err-suggestion-parse-${Date.now()}`, text: "Error parsing suggestions from AI.", sender: MessageSender.SYSTEM, timestamp: new Date() }]);
        }
      }
      setInitialQuerySuggestions(suggestionsArray.slice(0, 4)); 
    } catch (e: any) {
      const errorMessage = e.message || 'Failed to fetch initial suggestions.';
      setChatMessages(prev => [...prev, { id: `sys-err-suggestion-fetch-${Date.now()}`, text: `Error fetching suggestions: ${errorMessage}`, sender: MessageSender.SYSTEM, timestamp: new Date() }]);
    } finally {
      setIsFetchingSuggestions(false);
    }
  }, []); 

  useEffect(() => {
    if (currentKnowledgeItems.length > 0 && process.env.API_KEY) { 
        fetchAndSetInitialSuggestions(currentKnowledgeItems);
    } else {
        setInitialQuerySuggestions([]); 
    }
  }, [currentKnowledgeItems, fetchAndSetInitialSuggestions]); 


  const handleAddItem = (item: KnowledgeItem) => {
    setKnowledgeGroups(prevGroups => 
      prevGroups.map(group => {
        if (group.id === activeKnowledgeGroupId) {
          if (group.items.length < MAX_ITEMS) {
            // FIX: The original duplicate check used a ternary operator that confused TypeScript's type narrowing.
            // This led to an error when trying to access `.name` on a URL-type item.
            // The logic is replaced with explicit, type-safe checks.
            const isDuplicate = group.items.some(i => {
              if (i.type !== item.type) return false;
              if (i.type === 'url' && item.type === 'url') {
                return i.value === item.value;
              }
              if (i.type === 'file' && item.type === 'file') {
                 return i.name === item.name;
              }
              return false;
            });
            if (!isDuplicate) {
              return { ...group, items: [...group.items, item] };
            }
          }
        }
        return group;
      })
    );
  };
  
  const handleAddFiles = (files: { name: string, content: string, mimeType: string }[]) => {
    const newItems: KnowledgeItem[] = files.map(f => ({ type: 'file', name: f.name, content: f.content, mimeType: f.mimeType }));
     setKnowledgeGroups(prevGroups => 
      prevGroups.map(group => {
        if (group.id === activeKnowledgeGroupId) {
          if (group.items.length + newItems.length <= MAX_ITEMS) {
            // Filter out duplicates by name
            const uniqueNewItems = newItems.filter(newItem => 
              !group.items.some(existingItem => {
                if (existingItem.type === 'file' && newItem.type === 'file') {
                  return existingItem.name === newItem.name;
                }
                return false;
              })
            );
            return { ...group, items: [...group.items, ...uniqueNewItems] };
          }
        }
        return group;
      })
    );
  };

  const handleRemoveItem = (itemToRemove: KnowledgeItem) => {
    setKnowledgeGroups(prevGroups =>
      prevGroups.map(group => {
        if (group.id === activeKnowledgeGroupId) {
          const newItems = group.items.filter(item => {
            if (item.type !== itemToRemove.type) return true;
            if (item.type === 'url' && itemToRemove.type === 'url') {
              return item.value !== itemToRemove.value;
            }
            if (item.type === 'file' && itemToRemove.type === 'file') {
              return item.name !== itemToRemove.name;
            }
            return true;
          });
          return { ...group, items: newItems };
        }
        return group;
      })
    );
  };

  const handleAddGroup = (groupName: string) => {
    const newGroup: KnowledgeGroup = {
      id: `group-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: groupName.trim(),
      items: [],
    };
    setKnowledgeGroups(prev => [...prev, newGroup]);
    setActiveKnowledgeGroupId(newGroup.id);
  };

  const handleRemoveGroup = (groupIdToRemove: string) => {
    if (knowledgeGroups.length <= 1) {
      return;
    }
    
    setKnowledgeGroups(prev => {
        const remainingGroups = prev.filter(group => group.id !== groupIdToRemove);
        if (activeKnowledgeGroupId === groupIdToRemove) {
            setActiveKnowledgeGroupId(remainingGroups[0].id);
        }
        return remainingGroups;
    });
  };

  const handleMoveItemsAndDeleteGroup = (sourceGroupId: string, destinationGroupId: string) => {
    if (sourceGroupId === destinationGroupId || knowledgeGroups.length <= 1) {
      return;
    }

    setKnowledgeGroups(prevGroups => {
      const sourceGroup = prevGroups.find(g => g.id === sourceGroupId);
      const destinationGroup = prevGroups.find(g => g.id === destinationGroupId);

      if (!sourceGroup || !destinationGroup) {
        return prevGroups;
      }

      const itemsToMove = sourceGroup.items.filter(sourceItem => {
        return !destinationGroup.items.some(destItem => {
          if (sourceItem.type !== destItem.type) return false;
          if (sourceItem.type === 'url' && destItem.type === 'url') {
            return sourceItem.value === destItem.value;
          }
          if (sourceItem.type === 'file' && destItem.type === 'file') {
            return sourceItem.name === destItem.name;
          }
          return false;
        });
      });

      const updatedGroups = prevGroups.map(group => {
        if (group.id === destinationGroupId) {
          return { ...group, items: [...group.items, ...itemsToMove].slice(0, MAX_ITEMS) };
        }
        return group;
      }).filter(group => group.id !== sourceGroupId);

      if (activeKnowledgeGroupId === sourceGroupId) {
        setActiveKnowledgeGroupId(destinationGroupId);
      }

      return updatedGroups;
    });
  };


  const handleSendMessage = async (query: string) => {
    if (!query.trim() || isLoading || isFetchingSuggestions) return;

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
       setChatMessages(prev => [...prev, {
        id: `error-apikey-${Date.now()}`,
        text: 'ERROR: API Key (process.env.API_KEY) is not configured. Please set it up to send messages.',
        sender: MessageSender.SYSTEM,
        timestamp: new Date(),
      }]);
      return;
    }
    
    setIsLoading(true);
    setInitialQuerySuggestions([]); 

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      text: query,
      sender: MessageSender.USER,
      timestamp: new Date(),
    };
    
    const modelPlaceholderMessage: ChatMessage = {
      id: `model-response-${Date.now()}`,
      text: 'Thinking...', 
      sender: MessageSender.MODEL,
      timestamp: new Date(),
      isLoading: true,
    };

    setChatMessages(prevMessages => [...prevMessages, userMessage, modelPlaceholderMessage]);

    try {
      const response = await generateContentWithKnowledgeContext(query, currentKnowledgeItems);
      setChatMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === modelPlaceholderMessage.id
            ? { ...modelPlaceholderMessage, text: response.text || "I received an empty response.", isLoading: false, urlContext: response.urlContextMetadata }
            : msg
        )
      );
    } catch (e: any) {
      const errorMessage = e.message || 'Failed to get response from AI.';
      setChatMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === modelPlaceholderMessage.id
            ? { ...modelPlaceholderMessage, text: `Error: ${errorMessage}`, sender: MessageSender.SYSTEM, isLoading: false } 
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestedQueryClick = (query: string) => {
    handleSendMessage(query);
  };
  
  const chatPlaceholder = currentKnowledgeItems.length > 0 
    ? `Ask questions about "${activeGroup?.name || 'current documents'}"...`
    : "Add documents to the knowledge base to enable chat.";

  return (
    <div 
      className="h-screen max-h-screen antialiased relative overflow-x-hidden bg-gray-50 dark:bg-[#121212] text-gray-900 dark:text-[#E2E2E2]"
    >
      {/* Overlay for mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      
      <div className="flex h-full w-full md:p-4 md:gap-4">
        {/* Sidebar */}
        <div className={`
          fixed top-0 left-0 h-full w-11/12 max-w-sm z-30 transform transition-transform ease-in-out duration-300 p-3
          md:static md:p-0 md:w-1/3 lg:w-1/4 md:h-full md:max-w-none md:translate-x-0 md:z-auto
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <KnowledgeBaseManager
            items={currentKnowledgeItems}
            onAddItem={handleAddItem}
            onAddFiles={handleAddFiles}
            onRemoveItem={handleRemoveItem}
            maxItems={MAX_ITEMS}
            knowledgeGroups={knowledgeGroups}
            activeKnowledgeGroupId={activeKnowledgeGroupId}
            onSetGroupId={setActiveKnowledgeGroupId}
            onCloseSidebar={() => setIsSidebarOpen(false)}
            onAddGroup={handleAddGroup}
            onRemoveGroup={handleRemoveGroup}
            onMoveItemsAndDeleteGroup={handleMoveItemsAndDeleteGroup}
          />
        </div>

        {/* Chat Interface */}
        <div className="w-full h-full p-3 md:p-0 md:w-2/3 lg:w-3/4">
          <ChatInterface
            messages={chatMessages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            placeholderText={chatPlaceholder}
            initialQuerySuggestions={initialQuerySuggestions}
            onSuggestedQueryClick={handleSuggestedQueryClick}
            isFetchingSuggestions={isFetchingSuggestions}
            onToggleSidebar={() => setIsSidebarOpen(true)}
          />
        </div>
      </div>
    </div>
  );
};

export default App;