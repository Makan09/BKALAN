import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

function App() {
  const [activeSection, setActiveSection] = useState('lycee_generale');
  const [activeSubcategory, setActiveSubcategory] = useState('');
  const [sections, setSections] = useState({});
  const [documents, setDocuments] = useState([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [userName, setUserName] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    description: '',
    file: null
  });
  const [uploading, setUploading] = useState(false);
  
  const ws = useRef(null);
  const messagesEndRef = useRef(null);

  // Load sections on component mount
  useEffect(() => {
    loadSections();
  }, []);

  // Load documents when section or subcategory changes
  useEffect(() => {
    loadDocuments();
  }, [activeSection, activeSubcategory]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const loadSections = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/sections`);
      const data = await response.json();
      setSections(data);
      
      // Set default subcategory
      if (data.lycee_generale && data.lycee_generale.length > 0) {
        setActiveSubcategory(data.lycee_generale[0]);
      }
    } catch (error) {
      console.error('Error loading sections:', error);
    }
  };

  const loadDocuments = async () => {
    try {
      const url = `${BACKEND_URL}/api/documents?section=${activeSection}&subcategory=${activeSubcategory}`;
      const response = await fetch(url);
      const data = await response.json();
      setDocuments(data);
    } catch (error) {
      console.error('Error loading documents:', error);
    }
  };

  const handleSectionChange = (section) => {
    setActiveSection(section);
    // Set first subcategory as default
    if (sections[section] && sections[section].length > 0) {
      setActiveSubcategory(sections[section][0]);
    }
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    
    // Validation
    if (!uploadForm.file) {
      alert('Veuillez sélectionner un fichier');
      return;
    }
    
    if (!uploadForm.title.trim()) {
      alert('Veuillez entrer un titre');
      return;
    }

    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', uploadForm.file);
      formData.append('title', uploadForm.title.trim());
      formData.append('section', activeSection);
      formData.append('subcategory', activeSubcategory);
      formData.append('description', uploadForm.description.trim());

      console.log('Uploading file:', {
        title: uploadForm.title,
        section: activeSection,
        subcategory: activeSubcategory,
        fileName: uploadForm.file.name
      });

      const response = await fetch(`${BACKEND_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      
      if (response.ok) {
        alert('Fichier uploadé avec succès !');
        setShowUploadModal(false);
        setUploadForm({ title: '', description: '', file: null });
        loadDocuments(); // Refresh documents list
      } else {
        console.error('Upload error:', result);
        alert(`Erreur lors de l'upload: ${result.detail || 'Erreur inconnue'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Erreur lors de l\'upload. Vérifiez votre connexion.');
    } finally {
      setUploading(false);
    }
  };

  const connectToChat = () => {
    if (!userName.trim()) {
      alert('Veuillez entrer votre nom');
      return;
    }

    // Try WebSocket first, fallback to polling
    const wsUrl = `${BACKEND_URL.replace('https', 'wss').replace('http', 'ws')}/api/chat/ws/${encodeURIComponent(userName)}`;
    
    try {
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setIsConnected(true);
        loadChatMessages();
        setChatMessages(prev => [...prev, {
          user: 'Système',
          message: `${userName} a rejoint le chat`,
          timestamp: new Date().toISOString(),
          isSystem: true
        }]);
      };

      ws.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'message') {
          setChatMessages(prev => [...prev, {
            user: data.user,
            message: data.message,
            timestamp: data.timestamp
          }]);
        } else if (data.type === 'user_joined') {
          setChatMessages(prev => [...prev, {
            user: 'Système',
            message: `${data.user} a rejoint le chat`,
            timestamp: data.timestamp,
            isSystem: true
          }]);
        } else if (data.type === 'user_left') {
          setChatMessages(prev => [...prev, {
            user: 'Système',
            message: `${data.user} a quitté le chat`,
            timestamp: data.timestamp,
            isSystem: true
          }]);
        }
      };

      ws.current.onclose = () => {
        setIsConnected(false);
      };

      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        // Fallback to simple mode
        setIsConnected(true);
        loadChatMessages();
        setChatMessages(prev => [...prev, {
          user: 'Système',
          message: `${userName} a rejoint le chat (mode simple)`,
          timestamp: new Date().toISOString(),
          isSystem: true
        }]);
      };
    } catch (error) {
      console.error('WebSocket connection failed:', error);
      // Fallback to simple mode
      setIsConnected(true);
      loadChatMessages();
      setChatMessages(prev => [...prev, {
        user: 'Système',
        message: `${userName} a rejoint le chat (mode simple)`,
        timestamp: new Date().toISOString(),
        isSystem: true
      }]);
    }
  };

  const loadChatMessages = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/chat/messages`);
      const data = await response.json();
      setChatMessages(data);
    } catch (error) {
      console.error('Error loading chat messages:', error);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!currentMessage.trim()) return;

    const messageData = {
      user: userName,
      message: currentMessage,
      timestamp: new Date().toISOString()
    };

    // Try WebSocket first, fallback to direct API call
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        message: currentMessage
      }));
    } else {
      // Fallback: Direct API call to save message
      try {
        const response = await fetch(`${BACKEND_URL}/api/chat/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messageData)
        });

        if (response.ok) {
          // Add message to local state
          setChatMessages(prev => [...prev, messageData]);
          // Refresh messages to get updates from others
          setTimeout(loadChatMessages, 1000);
        }
      } catch (error) {
        console.error('Error sending message:', error);
        // Still add to local state for immediate feedback
        setChatMessages(prev => [...prev, messageData]);
      }
    }

    setCurrentMessage('');
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const disconnectFromChat = () => {
    if (ws.current) {
      ws.current.close();
    }
    setIsConnected(false);
    setChatMessages([]);
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getSectionTitle = (section) => {
    const titles = {
      'lycee_generale': 'Lycée Générale',
      'lycee_technique': 'Lycée Technique',
      'fondamentale': 'Fondamentale'
    };
    return titles[section] || section;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-stone-100">
      {/* Header */}
      <header className="bg-stone-900 text-amber-100 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold">BKalan</h1>
              <p className="ml-4 text-amber-200">Plateforme Éducative</p>
            </div>
            <div className="flex space-x-4">
              <button
                onClick={() => setShowUploadModal(true)}
                className="bg-amber-700 hover:bg-amber-600 px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Ajouter Document
              </button>
              <button
                onClick={() => setShowChatModal(true)}
                className="bg-stone-700 hover:bg-stone-600 px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Chat
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative bg-stone-800 text-white py-20">
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1491841550275-ad7854e35ca6?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzh8MHwxfHNlYXJjaHwxfHxlZHVjYXRpb258ZW58MHx8fGJsYWNrfDE3NTM1MTQ0OTh8MA&ixlib=rb-4.1.0&q=85)'
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold mb-6">Bienvenue sur BKalan</h2>
          <p className="text-xl mb-8 text-amber-200">
            Votre plateforme éducative pour tous les niveaux - Lycée Générale, Technique et Fondamentale
          </p>
          <div className="flex justify-center space-x-4">
            <button
              onClick={() => setShowUploadModal(true)}
              className="bg-amber-700 hover:bg-amber-600 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Partager un Document
            </button>
            <button
              onClick={() => setShowChatModal(true)}
              className="bg-stone-700 hover:bg-stone-600 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Rejoindre le Chat
            </button>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Section Navigation */}
        <div className="mb-8">
          <div className="flex space-x-1 bg-stone-200 p-1 rounded-lg">
            {Object.keys(sections).map((section) => (
              <button
                key={section}
                onClick={() => handleSectionChange(section)}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeSection === section
                    ? 'bg-stone-900 text-amber-100'
                    : 'text-stone-700 hover:bg-stone-300'
                }`}
              >
                {getSectionTitle(section)}
              </button>
            ))}
          </div>
        </div>

        {/* Subcategory Navigation */}
        {sections[activeSection] && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold mb-4 text-stone-800">
              {getSectionTitle(activeSection)} - Classes disponibles
            </h3>
            <div className="flex flex-wrap gap-2">
              {sections[activeSection].map((subcategory) => (
                <button
                  key={subcategory}
                  onClick={() => setActiveSubcategory(subcategory)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    activeSubcategory === subcategory
                      ? 'bg-amber-700 text-white'
                      : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                  }`}
                >
                  {subcategory}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Documents List */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h4 className="text-xl font-semibold mb-4 text-stone-800">
            Documents - {activeSubcategory}
          </h4>
          {documents.length === 0 ? (
            <p className="text-stone-500 text-center py-8">
              Aucun document disponible pour cette section.
            </p>
          ) : (
            <div className="grid gap-4">
              {documents.map((doc) => (
                <div key={doc.id} className="border border-stone-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h5 className="font-medium text-stone-800">{doc.title}</h5>
                      {doc.description && (
                        <p className="text-sm text-stone-600 mt-1">{doc.description}</p>
                      )}
                      <div className="flex items-center space-x-4 mt-2 text-sm text-stone-500">
                        <span>{formatFileSize(doc.file_size)}</span>
                        <span>{new Date(doc.upload_date).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <a
                      href={`${BACKEND_URL}/api/documents/${doc.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-amber-700 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                    >
                      Ouvrir
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 text-stone-800">Ajouter un Document</h3>
            <form onSubmit={handleFileUpload} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Titre du document
                </label>
                <input
                  type="text"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm({...uploadForm, title: e.target.value})}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Description (optionnel)
                </label>
                <textarea
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm({...uploadForm, description: e.target.value})}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  rows="3"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Fichier
                </label>
                <input
                  type="file"
                  onChange={(e) => setUploadForm({...uploadForm, file: e.target.files[0]})}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif"
                  required
                />
              </div>
              
              <div className="text-sm text-stone-600">
                <p>Section: {getSectionTitle(activeSection)}</p>
                <p>Classe: {activeSubcategory}</p>
              </div>
              
              <div className="flex space-x-4">
                <button
                  type="submit"
                  className="flex-1 bg-amber-700 hover:bg-amber-600 text-white py-2 rounded-lg font-medium transition-colors"
                >
                  Uploader
                </button>
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="flex-1 bg-stone-500 hover:bg-stone-400 text-white py-2 rounded-lg font-medium transition-colors"
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Chat Modal */}
      {showChatModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl h-96 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-stone-800">Chat en Temps Réel</h3>
              <button
                onClick={() => setShowChatModal(false)}
                className="text-stone-500 hover:text-stone-700"
              >
                ✕
              </button>
            </div>
            
            {!isConnected ? (
              <div className="flex flex-col items-center justify-center flex-1">
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Entrez votre nom"
                  className="w-full max-w-xs px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 mb-4"
                />
                <button
                  onClick={connectToChat}
                  className="bg-amber-700 hover:bg-amber-600 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                >
                  Rejoindre le Chat
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto mb-4 p-4 border border-stone-200 rounded-lg bg-stone-50">
                  {chatMessages.map((msg, index) => (
                    <div key={index} className={`mb-2 ${msg.isSystem ? 'text-center text-stone-500 text-sm' : ''}`}>
                      {!msg.isSystem && (
                        <span className="font-medium text-stone-800">{msg.user}: </span>
                      )}
                      <span className={msg.isSystem ? 'italic' : 'text-stone-700'}>{msg.message}</span>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
                
                <form onSubmit={sendMessage} className="flex space-x-2">
                  <input
                    type="text"
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                    placeholder="Tapez votre message..."
                    className="flex-1 px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="submit"
                    className="bg-amber-700 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                  >
                    Envoyer
                  </button>
                </form>
                
                <div className="flex justify-center mt-2">
                  <button
                    onClick={disconnectFromChat}
                    className="text-stone-500 hover:text-stone-700 text-sm"
                  >
                    Déconnecter
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;