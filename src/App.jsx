// App.jsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Admin from './components/Admin';
import Student from './components/Student';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="/" element={<Student />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
