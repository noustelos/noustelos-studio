if (!document.body.classList.contains('page-id-42')) {
  // Run only inside the scoped lab pages.
} else {
  const nebula = document.querySelector('body.page-id-42.page-id-42-nebula .lab-nebula');
  const stage = document.querySelector('body.page-id-42.page-id-42-nebula .nebula-stage');
  const miniTerminal = document.querySelector('body.page-id-42.page-id-42-nebula .nebula-mini-terminal');

  if (!nebula || !stage || !miniTerminal) {
    // Skip if the interactive layer is not present.
  } else {
    const intensity = 84;
    const tiltMax = 13;
    const easing = 0.5;
    let targetX = 0;
    let targetY = 0;
    let targetRotateX = 0;
    let targetRotateY = 0;
    let currentX = 0;
    let currentY = 0;
    let currentRotateX = 0;
    let currentRotateY = 0;

    const animate = () => {
      currentX += (targetX - currentX) * easing;
      currentY += (targetY - currentY) * easing;
      currentRotateX += (targetRotateX - currentRotateX) * easing;
      currentRotateY += (targetRotateY - currentRotateY) * easing;

      nebula.style.transform = `translate(${currentX}px,${currentY}px) rotateX(${currentRotateX}deg) rotateY(${currentRotateY}deg) scale(1.18)`;
      window.requestAnimationFrame(animate);
    };

    document.addEventListener('mousemove', (e) => {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      const rect = stage.getBoundingClientRect();
      const localX = (e.clientX - rect.left) / rect.width;
      const localY = (e.clientY - rect.top) / rect.height;

      targetX = nx * intensity;
      targetY = ny * intensity;
      targetRotateY = nx * tiltMax;
      targetRotateX = -ny * tiltMax;

      if (localX >= 0 && localX <= 1 && localY >= 0 && localY <= 1) {
        const nearestEdge = Math.min(localX, 1 - localX, localY, 1 - localY);
        const glowStrength = Math.max(0, Math.min(0.62, 1 - nearestEdge / 0.24));
        const offsetPxX = 62;
        const offsetPxY = 48;
        const mouseInStageX = e.clientX - rect.left;
        const mouseInStageY = e.clientY - rect.top;
        const terminalX = Math.min(88, Math.max(12, ((mouseInStageX + offsetPxX) / rect.width) * 100));
        const terminalY = Math.min(88, Math.max(12, ((mouseInStageY - offsetPxY) / rect.height) * 100));

        stage.style.setProperty('--edge-glow-x', `${(localX * 100).toFixed(2)}%`);
        stage.style.setProperty('--edge-glow-y', `${(localY * 100).toFixed(2)}%`);
        stage.style.setProperty('--edge-glow-strength', glowStrength.toFixed(3));
        stage.style.setProperty('--terminal-x', `${terminalX.toFixed(2)}%`);
        stage.style.setProperty('--terminal-y', `${terminalY.toFixed(2)}%`);

        miniTerminal.classList.toggle('is-active', glowStrength > 0.14);
      } else {
        stage.style.setProperty('--edge-glow-strength', '0');
        miniTerminal.classList.remove('is-active');
      }
    });

    document.addEventListener('mouseleave', () => {
      targetX = 0;
      targetY = 0;
      targetRotateX = 0;
      targetRotateY = 0;
      stage.style.setProperty('--edge-glow-strength', '0');
      miniTerminal.classList.remove('is-active');
    });

    animate();
  }
}
