/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChatMessage, MessageSender, KnowledgeGroup, KnowledgeItem, ChatSession } from './types';
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
  let history: ChatSession[] = [];

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

  try {
    const savedHistory = localStorage.getItem('DOC_BROWSER_CHAT_HISTORY');
    if (savedHistory) {
      history = JSON.parse(savedHistory).map((session: any) => ({
        ...session,
        timestamp: new Date(session.timestamp),
        messages: session.messages.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
        }))
      }));
    }
  } catch (e) {
    console.error("Failed to load chat history:", e);
  }
  
  return { initialGroups: groups, initialActiveId: activeId, initialHistory: history };
};


const App: React.FC = () => {
  const { initialGroups, initialActiveId, initialHistory } = useMemo(() => loadInitialState(), []);
  
  const [knowledgeGroups, setKnowledgeGroups] = useState<KnowledgeGroup[]>(initialGroups);
  const [activeKnowledgeGroupId, setActiveKnowledgeGroupId] = useState<string>(initialActiveId);
  // New state to control whether we chat with the active group or all groups
  const [chatScope, setChatScope] = useState<'current' | 'all'>('current');

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [initialQuerySuggestions, setInitialQuerySuggestions] = useState<string[]>([]);
  
  // Chat History State
  const [chatHistory, setChatHistory] = useState<ChatSession[]>(initialHistory);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Ref to track previous context to prevent unnecessary chat resets in 'all' mode
  // Initialized with 'init' to force the first welcome message render
  const prevContextRef = useRef<{ scope: string, groupId: string, groupCount: number }>({ 
    scope: 'init', 
    groupId: '', 
    groupCount: 0 
  });

  const MAX_ITEMS = 20;

  // The items shown in the sidebar manager (always the active group)
  const activeGroup = knowledgeGroups.find(group => group.id === activeKnowledgeGroupId);
  const currentGroupItems = activeGroup ? activeGroup.items : [];
  
  // The items sent to the AI context (depends on chatScope)
  const contextItems = useMemo(() => {
    if (chatScope === 'current') {
      return currentGroupItems;
    } else {
      // Aggregate items from ALL groups
      const allItems = knowledgeGroups.flatMap(g => g.items);
      
      // Simple deduplication for URLs to save context window
      const uniqueItems: KnowledgeItem[] = [];
      const seenUrls = new Set<string>();
      
      for (const item of allItems) {
        if (item.type === 'url') {
          if (!seenUrls.has(item.value)) {
            seenUrls.add(item.value);
            uniqueItems.push(item);
          }
        } else {
          // Always add files (assuming unique names/content, or simply allow dupes if diff groups have same file)
          uniqueItems.push(item);
        }
      }
      return uniqueItems;
    }
  }, [chatScope, currentGroupItems, knowledgeGroups]);

  
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

  // Save chat history
  useEffect(() => {
      try {
          localStorage.setItem('DOC_BROWSER_CHAT_HISTORY', JSON.stringify(chatHistory));
      } catch (e) {
          console.error("Failed to save chat history:", e);
      }
  }, [chatHistory]);

   useEffect(() => {
    const apiKey = process.env.API_KEY;
    
    if (!apiKey) {
       setChatMessages([{
        id: `system-error-api-key-${Date.now()}`,
        text: '### ⚠️ Configuration Error\n\nThe `API_KEY` environment variable is missing.\n\nPlease set `process.env.API_KEY` with your Gemini API key to use this application.',
        sender: MessageSender.SYSTEM,
        timestamp: new Date(),
      }]);
      return;
    }

    const isAllScope = chatScope === 'all';
    const currentActiveGroup = knowledgeGroups.find(group => group.id === activeKnowledgeGroupId);
    const currentGroupCount = knowledgeGroups.length;
    
    const prev = prevContextRef.current;
    let shouldUpdate = false;
    
    // Check conditions for updating the chat context/welcome message
    
    // 1. Initial Load
    if (prev.scope === 'init') {
        shouldUpdate = true;
    }
    // 2. Scope Changed (e.g. from 'current' to 'all')
    else if (chatScope !== prev.scope) {
        shouldUpdate = true;
    }
    // 3. In 'all' mode, update if the number of knowledge groups changes
    else if (isAllScope && currentGroupCount !== prev.groupCount) {
        shouldUpdate = true;
    }
    // 4. In 'current' mode, update if the active group selection changes
    else if (!isAllScope && activeKnowledgeGroupId !== prev.groupId) {
        shouldUpdate = true;
    }

    // If a user manually loaded a session, we don't want to overwrite it with a welcome message
    // unless they change context *after* loading.
    if (currentSessionId && !shouldUpdate) return;

    // Update the reference for the next render
    prevContextRef.current = { 
        scope: chatScope, 
        groupId: activeKnowledgeGroupId,
        groupCount: currentGroupCount 
    };

    if (!shouldUpdate) return;

    // Reset Session ID if context changes significantly (optional, helps keep "New Chat" logic clean)
    setCurrentSessionId(null);

    // Construct the welcome message based on the current scope
    let welcomeText = '';
    if (isAllScope) {
        welcomeText = `### 🌐 All Knowledge Groups\n\nYou are currently chatting with content from **all ${currentGroupCount} knowledge groups**.\n\nAsk questions across your entire knowledge base, or try a suggestion below.`;
    } else {
        const groupName = currentActiveGroup?.name || 'Unknown Group';
        welcomeText = `### 📂 ${groupName}\n\nYou are chatting with the **"${groupName}"** group.\n\nAsk questions about the documents in this group, or try a suggestion below.`;
    }
    
    // Reset chat with new welcome message
    setChatMessages([{
      id: `system-welcome-${Date.now()}`,
      text: welcomeText,
      sender: MessageSender.SYSTEM,
      timestamp: new Date(),
    }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKnowledgeGroupId, chatScope, knowledgeGroups.length]); 


  const fetchAndSetInitialSuggestions = useCallback(async (itemsForSuggestions: KnowledgeItem[]) => {
    if (itemsForSuggestions.length === 0) {
      setInitialQuerySuggestions([]);
      return;
    }
      
    setIsFetchingSuggestions(true);
    setInitialQuerySuggestions([]); 

    try {
      const response = await getInitialSuggestions(itemsForSuggestions); 
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
      // Increased limit from 4 to 10 to show more suggestions
      setInitialQuerySuggestions(suggestionsArray.slice(0, 10)); 
    } catch (e: any) {
      const errorMessage = e.message || 'Failed to fetch initial suggestions.';
      setChatMessages(prev => [...prev, { id: `sys-err-suggestion-fetch-${Date.now()}`, text: `Error fetching suggestions: ${errorMessage}`, sender: MessageSender.SYSTEM, timestamp: new Date() }]);
    } finally {
      setIsFetchingSuggestions(false);
    }
  }, []); 

  useEffect(() => {
    if (contextItems.length > 0 && process.env.API_KEY) { 
        fetchAndSetInitialSuggestions(contextItems);
    } else {
        setInitialQuerySuggestions([]); 
    }
  }, [contextItems, fetchAndSetInitialSuggestions]); 

  // --- Chat Session Management ---

  const handleNewChat = () => {
      setCurrentSessionId(null);
      // Triggering a context refresh or just resetting to default welcome
      const isAllScope = chatScope === 'all';
      const currentActiveGroup = knowledgeGroups.find(group => group.id === activeKnowledgeGroupId);
      const currentGroupCount = knowledgeGroups.length;
      
      let welcomeText = '';
      if (isAllScope) {
        welcomeText = `### 🌐 All Knowledge Groups\n\nYou are currently chatting with content from **all ${currentGroupCount} knowledge groups**.\n\nAsk questions across your entire knowledge base, or try a suggestion below.`;
      } else {
        const groupName = currentActiveGroup?.name || 'Unknown Group';
        welcomeText = `### 📂 ${groupName}\n\nYou are chatting with the **"${groupName}"** group.\n\nAsk questions about the documents in this group, or try a suggestion below.`;
      }

      setChatMessages([{
        id: `system-welcome-${Date.now()}`,
        text: welcomeText,
        sender: MessageSender.SYSTEM,
        timestamp: new Date(),
      }]);
      
      if (window.innerWidth < 768) {
        setIsSidebarOpen(false);
      }
  };

  const handleLoadSession = (session: ChatSession) => {
      setCurrentSessionId(session.id);
      setChatMessages(session.messages);
      if (window.innerWidth < 768) {
        setIsSidebarOpen(false);
      }
  };

  const handleDeleteSession = (sessionId: string) => {
      setChatHistory(prev => prev.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) {
          handleNewChat();
      }
  };

  const updateCurrentSession = (messages: ChatMessage[]) => {
      // Don't save if it's just the welcome message or empty
      const hasUserMessage = messages.some(m => m.sender === MessageSender.USER);
      if (!hasUserMessage) return;

      if (currentSessionId) {
          // Update existing session
          setChatHistory(prev => prev.map(session => {
              if (session.id === currentSessionId) {
                  return { ...session, messages, timestamp: new Date() };
              }
              return session;
          }));
      } else {
          // Create new session
          const newId = `session-${Date.now()}`;
          const userMsg = messages.find(m => m.sender === MessageSender.USER);
          const title = userMsg ? (userMsg.text.slice(0, 40) + (userMsg.text.length > 40 ? '...' : '')) : 'New Chat';
          
          const newSession: ChatSession = {
              id: newId,
              title,
              messages,
              timestamp: new Date()
          };
          setChatHistory(prev => [newSession, ...prev]);
          setCurrentSessionId(newId);
      }
  };


  const handleAddItem = (item: KnowledgeItem) => {
    setKnowledgeGroups(prevGroups => 
      prevGroups.map(group => {
        if (group.id === activeKnowledgeGroupId) {
          if (group.items.length < MAX_ITEMS) {
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
    // Automatically switch to 'current' scope when creating a new group so user can focus on it
    setChatScope('current');
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
    if (!query.trim() || isLoading) return;

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
       setChatMessages(prev => [...prev, {
        id: `error-apikey-${Date.now()}`,
        text: '### ⚠️ Configuration Error\n\nPlease configure `process.env.API_KEY` to send messages.',
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

    // Optimistic update
    const updatedMessages = [...chatMessages, userMessage, modelPlaceholderMessage];
    setChatMessages(updatedMessages);
    updateCurrentSession(updatedMessages); // Save immediate user input

    try {
      // Use contextItems (which respects chatScope) instead of currentGroupItems
      const response = await generateContentWithKnowledgeContext(query, contextItems);
      
      setChatMessages(prevMessages => {
        const nextMessages = prevMessages.map(msg =>
          msg.id === modelPlaceholderMessage.id
            ? { 
                ...modelPlaceholderMessage, 
                text: response.text || "I received an empty response.", 
                isLoading: false, 
                urlContext: response.urlContextMetadata,
                groundingMetadata: response.groundingMetadata
              }
            : msg
        );
        // Save final response
        updateCurrentSession(nextMessages);
        return nextMessages;
      });
    } catch (e: any) {
      const errorMessage = e.message || 'Failed to get response from AI.';
      setChatMessages(prevMessages => {
        const nextMessages = prevMessages.map(msg =>
          msg.id === modelPlaceholderMessage.id
            ? { ...modelPlaceholderMessage, text: `Error: ${errorMessage}`, sender: MessageSender.SYSTEM, isLoading: false } 
            : msg
        );
        updateCurrentSession(nextMessages);
        return nextMessages;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestedQueryClick = (query: string) => {
    handleSendMessage(query);
  };
  
  // Dynamic placeholder based on scope and content
  const chatPlaceholder = useMemo(() => {
    if (chatScope === 'all') {
      return `Ask questions about all ${knowledgeGroups.length} knowledge groups...`;
    }
    return currentGroupItems.length > 0 
      ? `Ask questions about "${activeGroup?.name || 'current documents'}"...`
      : "Add documents to this group to enable chat.";
  }, [chatScope, knowledgeGroups.length, currentGroupItems.length, activeGroup?.name]);
    
  const isApiKeyMissing = !process.env.API_KEY;

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
            items={currentGroupItems} // Always show items for the ACTIVE group for management purposes
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
            chatScope={chatScope}
            onSetChatScope={setChatScope}
            // History Props
            chatHistory={chatHistory}
            currentSessionId={currentSessionId}
            onLoadSession={handleLoadSession}
            onDeleteSession={handleDeleteSession}
            onNewChat={handleNewChat}
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
            inputDisabled={isApiKeyMissing}
            onNewChat={handleNewChat}
          />
        </div>
      </div>
    </div>
  );
};

export default App;