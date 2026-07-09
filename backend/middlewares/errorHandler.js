export const notFoundHandler = (req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' })
}

export const errorHandler = (err, req, res, next) => {
    console.error(err)
    const status = err.status || 500
    res.status(status).json({
        success: false,
        message: err.message || 'Internal Server Error',
    })
}
